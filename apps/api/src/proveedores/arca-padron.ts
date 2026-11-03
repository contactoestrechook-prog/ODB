import { BadRequestException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { cuitArca, decodificarXml, emisorConfigurado, entornoArca, obtenerTicket, postXmlArca } from '../caja/arca-wsaa';
import { DatosArca, leerConstanciaArca } from './ficha';

// Constancia de inscripción de ARCA (3/11/2026): con el CUIT del proveedor
// trae la razón social, el domicilio fiscal, la condición de IVA, la actividad
// y si la clave está activa. Usa el mismo certificado de ODB que factura; ARCA
// pide que el servicio «ws_sr_constancia_inscripcion» esté asociado a ese
// certificado (Administrador de Relaciones de Clave Fiscal). Si no lo está, el
// login lo rechaza y la pantalla lo explica: nada se rompe, se carga a mano.

const URL_PADRON = {
  produccion: 'https://aws.afip.gov.ar/sr-padron/webservices/personaServiceA5',
  homologacion: 'https://awshomo.afip.gov.ar/sr-padron/webservices/personaServiceA5',
};

export async function consultarCuitArca(db: SupabaseClient, cuit: string): Promise<DatosArca> {
  if (!emisorConfigurado('principal')) throw new BadRequestException('ODB no tiene cargado el certificado de ARCA en este servidor');
  let ticket;
  try {
    ticket = await obtenerTicket(db, 'ws_sr_constancia_inscripcion');
  } catch (e: any) {
    const m = String(e?.message ?? '');
    if (/notAuthorized|no autorizado|Computador no autorizado|cms\.cert/i.test(m)) {
      throw new BadRequestException('ARCA todavía no deja consultar CUIT con el certificado de ODB: hay que asociarle el servicio «Constancia de inscripción» en el Administrador de Relaciones de ARCA. Mientras tanto, cargá los datos a mano.');
    }
    throw e;
  }
  const soap =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:a5="http://a5.soap.ws.server.puc.sr/">` +
    `<soapenv:Header/><soapenv:Body><a5:getPersona_v2>` +
    `<token>${ticket.token}</token><sign>${ticket.sign}</sign>` +
    `<cuitRepresentada>${cuitArca('principal')}</cuitRepresentada><idPersona>${cuit}</idPersona>` +
    `</a5:getPersona_v2></soapenv:Body></soapenv:Envelope>`;
  const { status, texto } = await postXmlArca(URL_PADRON[entornoArca()], { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: '' }, soap, 20_000);
  const xml = decodificarXml(texto);
  if (status >= 400) {
    const detalle = xml.match(/<faultstring>([\s\S]*?)<\/faultstring>/)?.[1] ?? `HTTP ${status}`;
    if (/No existe persona/i.test(detalle)) throw new BadRequestException('ARCA no tiene ninguna persona con ese CUIT');
    throw new BadRequestException(`ARCA no respondió la consulta: ${detalle}`);
  }
  return leerConstanciaArca(xml);
}
