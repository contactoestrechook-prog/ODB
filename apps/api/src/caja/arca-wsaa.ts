import { BadRequestException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import * as forge from 'node-forge';
import { readFileSync } from 'fs';
import { Agent, request as httpsRequest } from 'https';

// Los servidores de ARCA usan parámetros TLS viejos (DH chico) que OpenSSL
// moderno rechaza. Este agente baja el nivel de seguridad SOLO para ARCA.
const agenteArca = new Agent({ ciphers: 'DEFAULT@SECLEVEL=1', keepAlive: true });

export function postXmlArca(
  url: string,
  headers: Record<string, string>,
  body: string,
  timeoutMs = 30_000,
): Promise<{ status: number; texto: string }> {
  return new Promise((resolver, rechazar) => {
    const req = httpsRequest(url, { method: 'POST', headers, agent: agenteArca, timeout: timeoutMs }, (res) => {
      let datos = '';
      res.on('data', (ch) => (datos += ch));
      res.on('end', () => resolver({ status: res.statusCode ?? 0, texto: datos }));
    });
    req.on('timeout', () => { req.destroy(new Error(`ARCA no respondió en ${timeoutMs / 1000}s`)); });
    req.on('error', rechazar);
    req.write(body);
    req.end();
  });
}

// WSAA: el "login" de los webservices de ARCA. Se firma un ticket de pedido
// (LoginTicketRequest) con el certificado digital del CUIT y ARCA devuelve un
// token+sign que vale ~12 horas. ARCA RECHAZA pedir un ticket nuevo mientras
// hay uno vigente, por eso se persiste en la tabla arca_tokens.

const WSAA_URL = {
  produccion: 'https://wsaa.afip.gov.ar/ws/services/LoginCms',
  homologacion: 'https://wsaahomo.afip.gov.ar/ws/services/LoginCms',
};

export function entornoArca(): 'produccion' | 'homologacion' {
  return process.env.ARCA_ENTORNO === 'homologacion' ? 'homologacion' : 'produccion';
}

// El cert y la clave pueden venir por contenido (Railway) o por archivo (local)
function materialArca(): { cert: string; key: string } {
  const certPem = process.env.ARCA_CERT_PEM ?? (process.env.ARCA_CERT_PATH ? readFileSync(process.env.ARCA_CERT_PATH, 'utf8') : '');
  const keyPem = process.env.ARCA_KEY_PEM ?? (process.env.ARCA_KEY_PATH ? readFileSync(process.env.ARCA_KEY_PATH, 'utf8') : '');
  if (!certPem || !keyPem) {
    throw new BadRequestException(
      'Facturación ARCA sin configurar: faltan ARCA_CERT_PEM y ARCA_KEY_PEM (o *_PATH) además de ARCA_CUIT',
    );
  }
  return { cert: certPem, key: keyPem };
}

export function cuitArca(): string {
  const c = (process.env.ARCA_CUIT ?? '').replace(/\D/g, '');
  if (!c) throw new BadRequestException('Falta ARCA_CUIT en el entorno');
  return c;
}

// Firma CMS (PKCS#7) del ticket, como exige WSAA.
function firmarCms(xml: string): string {
  const { cert, key } = materialArca();
  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(xml, 'utf8');
  const certificado = forge.pki.certificateFromPem(cert);
  const clave = forge.pki.privateKeyFromPem(key);
  p7.addCertificate(certificado);
  p7.addSigner({
    key: clave as any,
    certificate: certificado,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: new Date() as any },
    ],
  });
  p7.sign();
  const der = forge.asn1.toDer(p7.toAsn1()).getBytes();
  return forge.util.encode64(der);
}

export type TicketArca = { token: string; sign: string; expira: string };

// Devuelve un ticket vigente para el servicio (cacheado en DB) o pide uno nuevo.
export async function obtenerTicket(db: SupabaseClient, servicio: 'wsfe'): Promise<TicketArca> {
  const { data: guardado } = await db
    .from('arca_tokens')
    .select('token, sign, expira')
    .eq('servicio', servicio)
    .maybeSingle();
  if (guardado && new Date(guardado.expira).getTime() - Date.now() > 10 * 60_000) {
    return guardado as TicketArca;
  }

  // ticket nuevo: LoginTicketRequest firmado con el certificado
  const ahora = Date.now();
  const unique = Math.floor(ahora / 1000);
  const gen = new Date(ahora - 5 * 60_000).toISOString();
  const exp = new Date(ahora + 12 * 3600_000).toISOString();
  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<loginTicketRequest version="1.0"><header><uniqueId>${unique}</uniqueId>` +
    `<generationTime>${gen}</generationTime><expirationTime>${exp}</expirationTime></header>` +
    `<service>${servicio}</service></loginTicketRequest>`;
  const cms = firmarCms(xml);

  const soap =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wsaa="http://wsaa.view.sua.dvadac.desein.afip.gov">` +
    `<soapenv:Header/><soapenv:Body><wsaa:loginCms><wsaa:in0>${cms}</wsaa:in0></wsaa:loginCms></soapenv:Body></soapenv:Envelope>`;

  const { status, texto } = await postXmlArca(
    WSAA_URL[entornoArca()],
    { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: '' },
    soap,
  );
  if (status >= 400) {
    const detalle = texto.match(/<faultstring>([\s\S]*?)<\/faultstring>/)?.[1] ?? `HTTP ${status}`;
    throw new BadRequestException(`WSAA rechazó el login: ${decodificarXml(detalle)}`);
  }

  // la respuesta trae el loginTicketResponse escapado dentro del SOAP
  const cuerpo = decodificarXml(texto);
  const token = cuerpo.match(/<token>([\s\S]*?)<\/token>/)?.[1];
  const sign = cuerpo.match(/<sign>([\s\S]*?)<\/sign>/)?.[1];
  const expira = cuerpo.match(/<expirationTime>([\s\S]*?)<\/expirationTime>/)?.[1];
  if (!token || !sign || !expira) throw new BadRequestException('WSAA devolvió una respuesta sin token/sign');

  const ticket = { token, sign, expira: new Date(expira).toISOString() };
  await db.from('arca_tokens').upsert({ servicio, ...ticket, actualizado_en: new Date().toISOString() });
  return ticket;
}

export function decodificarXml(s: string): string {
  return s
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&');
}
