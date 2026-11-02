import { Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { sesionPrincipal, wahaUrlDe } from './lineas';

// EL despachador de WhatsApp del sistema: todo lo que sale (lo que contesta el
// bot, los avisos a administración, el «pedido listo» al cliente, el enlace para
// recuperar la clave, los resúmenes de cuenta corriente) pasa por acá.
// Hasta el 2/11/2026 el bot tenía su propia copia de esta puerta en
// bot.service.ts, con diferencias que nadie eligió: traducía los @lid y esta no,
// anotaba los envíos distinto y esperaba distinto a los archivos. Cada arreglo
// había que hacerlo dos veces. Ahora hay una sola.
//
// El sistema despacha por WAHA, una instancia propia que maneja la sesión de
// WhatsApp del negocio. No pasa por Meta: no hay plantillas, ni ventana de 24
// horas, ni phone_number_id. Qué WAHA atiende cada sesión lo sabe comun/lineas.ts.
//
// Todo lo que sale queda registrado en bot_envios por su id: así, cuando
// WhatsApp devuelve un mensaje "fromMe", el bot sabe si lo mandó el sistema o lo
// tecleó una persona desde el teléfono (si no, esa charla quedaría «atendida
// desde el teléfono» y el bot se callaría).

const log = new Logger('WhatsApp');

// Número de WhatsApp de un celular argentino, como lo espera WhatsApp: 549 + área
// + número. En las fichas hay de todo ("11 2281-2200", "541122812200",
// "+54 9 11…", "011 15…"); sin el 9 WhatsApp acepta el envío y no le llega a
// nadie (16/9/2026: el enlace para recuperar la clave de Jackie salió a
// 541122812200). Números de otros países se dejan como vienen.
export function celularWhatsapp(numero: string): string {
  let d = String(numero ?? '').replace(/\D/g, '');
  if (!d) return d;
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('549')) return d;
  if (d.startsWith('54')) {
    let resto = d.slice(2);
    if (resto.startsWith('0')) resto = resto.slice(1);
    resto = resto.replace(/^(\d{2,4})15(\d{6,8})$/, '$1$2');
    return resto.length === 10 ? `549${resto}` : d;
  }
  // local: "011 15 2281-2200", "11 2281-2200". "15 2281 2200" no trae código de
  // área: no se inventa uno.
  if (d.startsWith('15') && d.length === 10) return d;
  if (d.startsWith('0')) d = d.slice(1);
  d = d.replace(/^(\d{2,4})15(\d{6,8})$/, '$1$2');
  return d.length === 10 ? `549${d}` : d;
}

export type ResultadoWaha = {
  enviado: boolean;
  id?: string | null;
  motivo?: string;
  /** No sé si salió (corte por tiempo o error del servidor): no repetir sin mirar. */
  incierto?: boolean;
  /** Seguro NO salió, por algo nuestro (sin WhatsApp configurado): se puede repetir. */
  reintentable?: boolean;
  /** La nota de voz salió como archivo adjunto (WhatsApp rechazó el audio). */
  comoArchivo?: boolean;
};

export type EnvioWhatsapp = {
  /** Un número (como venga), un chatId "549…@c.us" o un "<id>@lid" tal cual. */
  to: string;
  /** La sesión de WAHA por la que sale; sin sesión, la de la línea principal. */
  sesion?: string | null;
  text?: string | null;
  imagenUrl?: string | null;
  /** Un PDF u otro archivo: viaja como documento adjunto, con `text` de epígrafe. */
  documentoUrl?: string | null;
  nombreArchivo?: string | null;
  audioUrl?: string | null;
  /** bot_envios.origen: 'bot', 'aviso-interno', 'difusion'… */
  origen?: string | null;
  referencia?: string | null;
};

// El destino. Un chatId ("549…@c.us", "<id>@lid") va tal cual; un número se
// normaliza como celular argentino.
// Un @lid (el id de privacidad de WhatsApp) NO es un número marcable: armar
// "digitos@c.us" con él manda el mensaje a la nada o a un desconocido. Las
// charlas guardan esos dígitos como teléfono, así que acá se traduce al número
// real del contacto y, si no lo tenemos, al @lid tal cual (18/9/2026: una
// corrección al cliente no habría llegado nunca).
async function destinoDe(db: SupabaseClient, to: string): Promise<{ chatId: string; digitos: string } | null> {
  const crudo = String(to ?? '').trim();
  if (crudo.includes('@')) {
    const chatId = crudo.split(':')[0];
    return { chatId, digitos: chatId.replace(/\D/g, '') };
  }
  const digitos = celularWhatsapp(crudo);
  if (digitos.length < 8) return null;
  if (digitos.length >= 11) {
    try {
      const { data: contacto } = await db.from('bot_contactos').select('telefono_real, lid').eq('telefono', digitos).maybeSingle();
      const lid = String((contacto as any)?.lid ?? '');
      if (lid.startsWith(digitos)) {
        const real = String((contacto as any)?.telefono_real ?? '').replace(/\D/g, '');
        const chatId = real ? `${real}@c.us` : lid;
        log.log(`destino @lid traducido: ${digitos} → ${chatId}`);
        return { chatId, digitos };
      }
    } catch { /* sin la tabla a mano (pruebas), el número tal cual */ }
  }
  return { chatId: `${digitos}@c.us`, digitos };
}

// Un POST a WAHA. Tira si WAHA no contesta.
async function postear(base: string, key: string, ruta: string, cuerpo: Record<string, unknown>, ms: number): Promise<{ ok: boolean; estado: number; cuerpo: any }> {
  const ctrl = new AbortController();
  const reloj = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(`${base}${ruta}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': key },
      body: JSON.stringify(cuerpo),
      signal: ctrl.signal,
    });
    return { ok: r.ok, estado: r.status, cuerpo: await r.json().catch(() => ({})) };
  } finally {
    clearTimeout(reloj);
  }
}

// el id completo ("true_549…@c.us_3EB0…") es el que trae el eco del mensaje
const idDe = (res: any): string | null =>
  res?.id?._serialized ?? (typeof res?.id === 'string' ? res.id : null) ?? res?.key?.id ?? res?._data?.id?.id ?? null;

const mimeDeImagen = (url: string) => {
  const ext = String(url).split('.').pop()!.toLowerCase().split('?')[0];
  return { ext: ext || 'jpg', mime: ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg' };
};

/**
 * Manda un mensaje por WhatsApp y lo registra en bot_envios. Distingue «no
 * salió» de «no sé si salió»: un corte por tiempo o un error del servidor NO
 * quiere decir que no salió (WAHA sigue trabajando y el mensaje puede llegar
 * igual), y eso vuelve como `incierto`. Quien llama no repite un envío incierto
 * sin mirar (el proveedor recibiría el pedido dos veces). Solo `reintentable`
 * es seguro de repetir.
 */
export async function enviarWhatsapp(db: SupabaseClient, e: EnvioWhatsapp): Promise<ResultadoWaha> {
  const sesion = e.sesion || sesionPrincipal();
  const base = wahaUrlDe(sesion);
  const key = process.env.WAHA_API_KEY;
  if (!base || !key) return { enviado: false, reintentable: true, motivo: 'WhatsApp sin configurar' };
  const d = await destinoDe(db, e.to);
  if (!d) return { enviado: false, reintentable: false, motivo: 'Número inválido' };

  // 9/10/2026: difusiones y programados se anotan como tales: un «sí» después puede ser a eso
  let origen = e.origen ?? null;
  if (!origen && /^(difusion|programado)\//.test(String(e.referencia ?? ''))) origen = String(e.referencia).split('/')[0];

  const post = (ruta: string, cuerpo: Record<string, unknown>, ms: number) => postear(base, key, ruta, { session: sesion, chatId: d.chatId, ...cuerpo }, ms);
  const fallo = (ruta: string, estado: number): ResultadoWaha => ({ enviado: false, motivo: `WAHA ${ruta.replace('/api/', '')} ${estado}`, incierto: estado >= 500 });
  // se ESPERA la anotación: si no, el eco llegaba antes y pausaba la charla
  const salio = async (id: string | null, extra: Partial<ResultadoWaha> = {}): Promise<ResultadoWaha> => {
    if (id) await db.from('bot_envios').insert({ waha_id: String(id), telefono: d.digitos, origen: origen ?? 'bot' }).then(() => null, () => null);
    return { enviado: true, id, ...extra };
  };

  try {
    // WAHA baja los archivos de la URL: tiene que ser accesible desde afuera (una URL firmada de Supabase sirve)
    if (e.documentoUrl) {
      const nombre = e.nombreArchivo || String(e.documentoUrl).split('/').pop()!.split('?')[0] || 'archivo.pdf';
      const mimetype = /\.pdf$/i.test(nombre) ? 'application/pdf' : 'application/octet-stream';
      const r = await post('/api/sendFile', { file: { url: e.documentoUrl, mimetype, filename: nombre }, caption: e.text || '' }, 60_000);
      return r.ok ? salio(idDe(r.cuerpo)) : fallo('/api/sendFile', r.estado);
    }
    if (e.imagenUrl) {
      const { ext, mime } = mimeDeImagen(e.imagenUrl);
      const r = await post('/api/sendImage', { file: { url: e.imagenUrl, mimetype: mime, filename: `foto.${ext}` }, caption: e.text || '' }, 60_000);
      return r.ok ? salio(idDe(r.cuerpo)) : fallo('/api/sendImage', r.estado);
    }
    if (e.audioUrl) {
      const webm = e.audioUrl.includes('.webm');
      const file = { url: e.audioUrl, mimetype: webm ? 'audio/webm; codecs=opus' : 'audio/ogg; codecs=opus', filename: `nota-de-voz${webm ? '.webm' : '.ogg'}` };
      const r = await post('/api/sendVoice', { file }, 60_000);
      if (!r.ok) {
        // WhatsApp solo reproduce notas de voz en OGG/Opus. Si rechaza el audio
        // (típico de un WebM de Android), se reintenta como archivo adjunto:
        // llega peor, pero llega, en vez de perderse en silencio.
        const alt = await post('/api/sendFile', { file, caption: '🎤 Nota de voz' }, 60_000);
        return alt.ok ? salio(idDe(alt.cuerpo), { comoArchivo: true }) : fallo('/api/sendVoice', r.estado);
      }
      const id = idDe(r.cuerpo);
      // sin id no hay prueba de que haya salido: se reporta como falla
      return id ? salio(id) : { enviado: false, motivo: 'WhatsApp no confirmó la nota de voz' };
    }
    const r = await post('/api/sendText', { text: e.text ?? '' }, 15_000);
    return r.ok ? salio(idDe(r.cuerpo)) : fallo('/api/sendText', r.estado);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn(`No se pudo contactar a WAHA (${sesion}): ${msg}`);
    return { enviado: false, motivo: `WAHA inalcanzable: ${msg}`, incierto: true };
  }
}

// Aviso interno por WhatsApp (a un supervisor, no a un cliente). Sin sesión sale
// por la línea principal; un aviso a un cliente puede pedir la de su línea (6/10/2026).
export function enviarTextoWhatsapp(db: SupabaseClient, to: string, text: string, origen = 'aviso_interno', sesion?: string): Promise<ResultadoWaha> {
  return enviarWhatsapp(db, { to, text, origen, sesion });
}

// Un archivo (PDF).
export function enviarArchivoWhatsapp(db: SupabaseClient, to: string, url: string, nombreArchivo: string, epigrafe = '', origen = 'aviso_interno', sesion?: string): Promise<ResultadoWaha> {
  return enviarWhatsapp(db, { to, documentoUrl: url, nombreArchivo, text: epigrafe, origen, sesion });
}

// Una imagen (la tarjeta Placa roja) con su epígrafe.
export function enviarImagenWhatsapp(db: SupabaseClient, to: string, url: string, epigrafe = '', origen = 'aviso_interno', sesion?: string): Promise<ResultadoWaha> {
  return enviarWhatsapp(db, { to, imagenUrl: url, text: epigrafe, origen, sesion });
}

// ¿Ese número tiene WhatsApp? WhatsApp ACEPTA mandar a un número que no existe
// y el mensaje no le llega a nadie, así que antes de mandarle algo importante a
// alguien nuevo (un proveedor) se pregunta. Prueba el celular (549…) y, si no,
// el mismo número sin el 9 (54…): así figura un WhatsApp Business en un fijo.
// Si WAHA no contesta, tira: nunca se da por bueno un número sin confirmarlo.
export async function existeEnWhatsapp(numero: string, sesion?: string): Promise<{ existe: boolean; chatId?: string; verificado: boolean }> {
  const wahaUrl = wahaUrlDe(sesion);
  const wahaKey = process.env.WAHA_API_KEY;
  if (!wahaUrl || !wahaKey) throw new Error('WAHA sin configurar');
  const celular = celularWhatsapp(numero);
  const candidatos = celular.startsWith('549') ? [celular, `54${celular.slice(3)}`] : [celular];
  for (const n of candidatos) {
    const ctrl = new AbortController();
    const reloj = setTimeout(() => ctrl.abort(), 15_000);
    try {
      const q = new URLSearchParams({ phone: n, session: sesion || sesionPrincipal() });
      const r = await fetch(`${wahaUrl}/api/contacts/check-exists?${q}`, { headers: { 'X-Api-Key': wahaKey }, signal: ctrl.signal });
      // la versión de WAHA no tiene la consulta: no se puede verificar, se usa el celular
      if (r.status === 404 || r.status === 501) return { existe: true, chatId: `${celular}@c.us`, verificado: false };
      if (!r.ok) throw new Error(`WAHA check-exists ${r.status}`);
      const j: any = await r.json().catch(() => ({}));
      if (j?.numberExists) return { existe: true, chatId: String(j.chatId || `${n}@c.us`), verificado: true };
    } finally {
      clearTimeout(reloj);
    }
  }
  return { existe: false, verificado: true };
}
