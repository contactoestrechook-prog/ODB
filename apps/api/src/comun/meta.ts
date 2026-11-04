import { createHmac, timingSafeEqual } from 'crypto';
import { Logger } from '@nestjs/common';

// LA API OFICIAL DE WHATSAPP (Cloud API de Meta), 4/11/2026.
//
// MetoGroup quedó aprobado como proveedor de tecnología y la línea general de
// O.D.B (11 2281-2200) pasa de WAHA a la API oficial en coexistencia: el
// teléfono sigue con WhatsApp Business y el sistema recibe y manda por Meta.
// Con WAHA la línea quedaba sorda cada tanto («Stream Errored», «failed to
// decrypt», QR vencidos) y hablar de alcohol solo está permitido por la API.
//
// Este archivo es la única puerta a Meta. Lo que entra se traduce al MISMO
// formato que manda WAHA (eventosDeMeta), así el bot procesa igual venga de
// donde venga; lo que sale pasa por enviarWhatsapp (comun/whatsapp.ts), que
// mira esMeta(sesion) y viene acá. Qué sesión va por Meta lo dicen variables:
//   META_SESIONES=odb                 sesiones (separadas por coma) que van por Meta
//   META_PHONE_ID_ODB=1234…           el phone_number_id de cada una (o META_PHONE_ID si hay una sola)
//   META_TOKEN                        el token del usuario del sistema de MetoGroup con la cuenta de O.D.B asignada
//   META_APP_SECRET                   la clave secreta de la app RESPONDE MetoGroup (firma de los webhooks)
//   META_VERIFY_TOKEN                 la palabra para verificar el webhook al darlo de alta
//   META_RESPALDO_SESION=odb-local    por dónde sale lo que Meta rechaza por estar fuera de las 24 h
// Sin META_SESIONES nada cambia: todo sigue por WAHA.

const log = new Logger('WhatsApp Meta');
const GRAPH = () => `https://graph.facebook.com/${process.env.META_GRAPH_VERSION || 'v23.0'}`;

const lista = (v?: string) => String(v ?? '').split(',').map((x) => x.trim()).filter(Boolean);

/** Las sesiones que van por la API oficial. */
export function sesionesMeta(): string[] {
  return lista(process.env.META_SESIONES);
}

/** ¿Esa sesión va por la API oficial? Sin sesión es la principal, que decide quien llama. */
export function esMeta(sesion?: string | null): boolean {
  return !!sesion && sesionesMeta().includes(sesion) && !!process.env.META_TOKEN;
}

const claveEnv = (sesion: string) => `META_PHONE_ID_${sesion.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;

/** El phone_number_id de Meta de una sesión. */
export function phoneIdDe(sesion: string): string | undefined {
  return process.env[claveEnv(sesion)] || (sesionesMeta().length === 1 ? process.env.META_PHONE_ID : undefined) || undefined;
}

/** La sesión de un phone_number_id (para saber por qué línea entró un mensaje). */
export function sesionDePhoneId(phoneId: string): string | null {
  return sesionesMeta().find((s) => phoneIdDe(s) === String(phoneId)) ?? null;
}

/** La sesión de WAHA por la que sale lo que Meta no deja mandar (fuera de las 24 h). */
export function sesionRespaldoMeta(): string | null {
  const s = String(process.env.META_RESPALDO_SESION ?? '').trim();
  return s && !esMeta(s) ? s : null;
}

// ---------------------------------------------------------------- webhook

/**
 * La firma de Meta: X-Hub-Signature-256 = sha256=<HMAC del cuerpo crudo con la
 * clave secreta de la app>. Sin la clave configurada NO se acepta nada
 * (cualquiera podría inventarle mensajes al bot).
 */
export function firmaMetaValida(crudo: Buffer | string | undefined, firma: string | undefined): boolean {
  const secreto = process.env.META_APP_SECRET;
  if (!secreto || !crudo || !firma) return false;
  const esperada = 'sha256=' + createHmac('sha256', secreto).update(crudo).digest('hex');
  const a = Buffer.from(esperada);
  const b = Buffer.from(String(firma));
  return a.length === b.length && timingSafeEqual(a, b);
}

export type EventoTraducido = { evento: any; numeroLinea: string };

const TIPOS: Record<string, string> = { text: 'chat', image: 'image', video: 'video', document: 'document', sticker: 'sticker', location: 'location', contacts: 'vcard' };

// Un mensaje de Meta con la forma del payload de WAHA que lee el bot: id, from,
// body, type, hasMedia/media, caption, replyTo, location, notifyName.
function comoWaha(m: any, nombre: string | null, fromMe: boolean): any | null {
  const tipo = String(m?.type ?? '');
  if (tipo === 'reaction' || tipo === 'ephemeral' || tipo === 'system') return null;
  const media = m?.image ?? m?.video ?? m?.audio ?? m?.document ?? m?.sticker ?? null;
  let body = '';
  if (tipo === 'text') body = String(m.text?.body ?? '');
  else if (tipo === 'interactive') body = String(m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? '');
  else if (tipo === 'button') body = String(m.button?.text ?? '');
  else if (media?.caption) body = String(media.caption);
  const p: any = {
    id: String(m.id ?? ''),
    from: `${String(fromMe ? m.from : m.from ?? '').replace(/\D/g, '')}@c.us`,
    to: fromMe ? `${String(m.to ?? '').replace(/\D/g, '')}@c.us` : undefined,
    fromMe,
    timestamp: Number(m.timestamp) || Math.floor(Date.now() / 1000),
    body,
    type: tipo === 'audio' ? (m.audio?.voice ? 'ptt' : 'audio') : TIPOS[tipo] ?? (tipo === 'interactive' || tipo === 'button' ? 'chat' : tipo),
    notifyName: nombre ?? undefined,
    replyTo: m.context?.id ? { id: String(m.context.id) } : undefined,
    _meta: true,
  };
  if (media?.id) {
    p.hasMedia = true;
    p.media = { metaId: String(media.id), mimetype: String(media.mime_type ?? ''), filename: m.document?.filename ?? undefined };
    if (media.caption) p.caption = String(media.caption);
  }
  if (tipo === 'location' && m.location) {
    p.location = { latitude: m.location.latitude, longitude: m.location.longitude, description: [m.location.name, m.location.address].filter(Boolean).join(' · ') || undefined };
  }
  if (tipo === 'contacts' && Array.isArray(m.contacts)) p.vCards = m.contacts.map((c: any) => `${c?.name?.formatted_name ?? ''} ${(c?.phones ?? []).map((x: any) => x?.phone).join(' ')}`.trim());
  return p;
}

/**
 * El cuerpo de un webhook de Meta → los eventos con forma de WAHA que entiende
 * el bot. `messages` son entrantes de clientes; `smb_message_echoes` son los que
 * alguien mandó desde la app del teléfono (coexistencia): van como fromMe para
 * que el bot se pause en esa charla, igual que con WAHA. Los estados de entrega
 * no se traducen: solo se registran los que fallaron.
 */
export function eventosDeMeta(cuerpo: any): EventoTraducido[] {
  const salida: EventoTraducido[] = [];
  for (const entrada of Array.isArray(cuerpo?.entry) ? cuerpo.entry : []) {
    for (const cambio of Array.isArray(entrada?.changes) ? entrada.changes : []) {
      const v = cambio?.value ?? {};
      const sesion = sesionDePhoneId(String(v?.metadata?.phone_number_id ?? ''));
      const numeroLinea = String(v?.metadata?.display_phone_number ?? '').replace(/\D/g, '');
      if (!sesion) {
        if (v?.metadata?.phone_number_id) log.warn(`webhook de un número que no es de ninguna sesión (phone_number_id ${v.metadata.phone_number_id})`);
        continue;
      }
      const me = { id: `${numeroLinea}@c.us` };
      if (cambio.field === 'messages') {
        const nombres = new Map<string, string>((v.contacts ?? []).map((c: any) => [String(c?.wa_id ?? ''), String(c?.profile?.name ?? '')]));
        for (const m of v.messages ?? []) {
          const p = comoWaha(m, nombres.get(String(m?.from ?? '')) || null, false);
          if (p) salida.push({ evento: { event: 'message', session: sesion, me, payload: p }, numeroLinea });
        }
        for (const s of v.statuses ?? []) {
          if (s?.status === 'failed') log.warn(`Meta no entregó ${s?.id} a ${s?.recipient_id}: ${(s?.errors ?? []).map((e: any) => `${e?.code} ${e?.title}`).join(', ')}`);
        }
      } else if (cambio.field === 'smb_message_echoes') {
        for (const m of v.message_echoes ?? []) {
          const p = comoWaha(m, null, true);
          if (p) salida.push({ evento: { event: 'message.any', session: sesion, me, payload: p }, numeroLinea });
        }
      }
    }
  }
  return salida;
}

// ---------------------------------------------------------------- envío

export type MensajeMeta = { text?: string | null; imagenUrl?: string | null; documentoUrl?: string | null; nombreArchivo?: string | null; audioUrl?: string | null };
export type RespuestaMeta = { ok: boolean; id?: string | null; estado: number; codigo?: number; detalle?: string; fueraDeVentana?: boolean };

// 131047: pasaron más de 24 h desde el último mensaje del cliente (solo plantillas).
// 131026: el número no tiene WhatsApp o no puede recibir.
const FUERA_DE_VENTANA = new Set([131047]);

/** Manda un mensaje por la API oficial. `para` son los dígitos del número (549…). */
export async function enviarPorMeta(sesion: string, para: string, m: MensajeMeta, ms = 20_000): Promise<RespuestaMeta> {
  const phoneId = phoneIdDe(sesion);
  const token = process.env.META_TOKEN;
  if (!phoneId || !token) return { ok: false, estado: 0, detalle: `sin phone_number_id o token para ${sesion}` };
  let cuerpo: Record<string, unknown>;
  if (m.documentoUrl) {
    const nombre = m.nombreArchivo || String(m.documentoUrl).split('/').pop()!.split('?')[0] || 'archivo.pdf';
    cuerpo = { type: 'document', document: { link: m.documentoUrl, filename: nombre, ...(m.text ? { caption: m.text } : {}) } };
  } else if (m.imagenUrl) {
    cuerpo = { type: 'image', image: { link: m.imagenUrl, ...(m.text ? { caption: m.text } : {}) } };
  } else if (m.audioUrl) {
    // Meta reproduce como nota de voz el OGG/Opus; un WebM va como archivo
    cuerpo = m.audioUrl.includes('.webm')
      ? { type: 'document', document: { link: m.audioUrl, filename: 'nota-de-voz.webm', caption: '🎤 Nota de voz' } }
      : { type: 'audio', audio: { link: m.audioUrl } };
  } else {
    cuerpo = { type: 'text', text: { body: String(m.text ?? ''), preview_url: true } };
  }
  try {
    const r = await fetch(`${GRAPH()}/${phoneId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to: para, ...cuerpo }),
      signal: AbortSignal.timeout(ms),
    });
    const j: any = await r.json().catch(() => ({}));
    if (r.ok) return { ok: true, id: j?.messages?.[0]?.id ?? null, estado: r.status };
    const codigo = Number(j?.error?.code) || undefined;
    const detalle = String(j?.error?.error_data?.details ?? j?.error?.message ?? '').slice(0, 200);
    return { ok: false, estado: r.status, codigo, detalle, fueraDeVentana: codigo != null && FUERA_DE_VENTANA.has(codigo) };
  } catch (e) {
    return { ok: false, estado: 0, detalle: e instanceof Error ? e.message : String(e) };
  }
}

/** Baja un archivo que mandó un cliente (foto, audio, PDF) con su id de Meta. */
export async function bajarMediaMeta(mediaId: string): Promise<{ buf: Buffer; mime: string } | null> {
  const token = process.env.META_TOKEN;
  if (!token || !mediaId) return null;
  const auth = { Authorization: `Bearer ${token}` };
  const info = await fetch(`${GRAPH()}/${encodeURIComponent(mediaId)}`, { headers: auth, signal: AbortSignal.timeout(10_000) });
  if (!info.ok) { log.warn(`Meta no dio el archivo ${mediaId} (${info.status})`); return null; }
  const j: any = await info.json();
  if (!j?.url) return null;
  const r = await fetch(String(j.url), { headers: auth, signal: AbortSignal.timeout(20_000) });
  if (!r.ok) { log.warn(`no pude bajar el archivo ${mediaId} de Meta (${r.status})`); return null; }
  return { buf: Buffer.from(await r.arrayBuffer()), mime: String(j.mime_type ?? r.headers.get('content-type') ?? 'application/octet-stream') };
}
