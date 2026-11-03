import { timingSafeEqual } from 'crypto';

// Lo que manda un equipo GPS, traducido a una sola forma. Llega por dos lados:
// - Traccar (el servidor que habla con los equipos de la camioneta, Teltonika,
//   Concox…) reenvía cada posición como JSON { position, device }.
// - La app Traccar Client (un celular fijo en el vehículo) o cualquier equipo
//   que hable el protocolo OsmAnd: parámetros id/lat/lon/timestamp/speed, o el
//   JSON { device_id, location: { coords, timestamp } } de las versiones nuevas.

export type LecturaGps = {
  equipo: string;
  lat: number;
  lng: number;
  velocidadKmh: number | null;
  en: Date; // hora de la lectura en el equipo, no la de llegada
};

export type Resultado = { ok: true; lectura: LecturaGps } | { ok: false; motivo: string };

const NUDOS_A_KMH = 1.852;
const MS_A_KMH = 3.6;
// un reloj adelantado no puede dejar una lectura "del futuro" que tape las que siguen
const TOLERANCIA_FUTURO_MS = 5 * 60_000;

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// timestamp en segundos, milisegundos o ISO; sin dato (o del futuro), la hora de llegada
export function horaDe(v: unknown, ahora = new Date()): Date {
  let d: Date | null = null;
  const n = num(v);
  if (n !== null) d = new Date(n < 1e12 ? n * 1000 : n);
  else if (typeof v === 'string' && v.trim()) d = new Date(v);
  if (!d || Number.isNaN(d.getTime()) || d.getTime() > ahora.getTime() + TOLERANCIA_FUTURO_MS) return ahora;
  return d;
}

function armar(equipo: unknown, lat: unknown, lng: unknown, velocidadKmh: number | null, hora: unknown, ahora: Date): Resultado {
  const id = typeof equipo === 'string' || typeof equipo === 'number' ? String(equipo).trim() : '';
  if (!id) return { ok: false, motivo: 'Falta el identificador del equipo' };
  const la = num(lat), ln = num(lng);
  if (la === null || ln === null || Math.abs(la) > 90 || Math.abs(ln) > 180) return { ok: false, motivo: 'Ubicación inválida' };
  // 0,0 es lo que mandan muchos equipos cuando todavía no engancharon satélites
  if (la === 0 && ln === 0) return { ok: false, motivo: 'Sin señal de GPS' };
  const vel = velocidadKmh !== null && velocidadKmh >= 0 ? Math.round(velocidadKmh * 10) / 10 : null;
  return { ok: true, lectura: { equipo: id, lat: la, lng: ln, velocidadKmh: vel, en: horaDe(hora, ahora) } };
}

export function leerTraccar(body: any, ahora = new Date()): Resultado {
  const p = body?.position;
  if (!p || typeof p !== 'object') return { ok: false, motivo: 'Falta la posición' };
  // valid=false: el equipo repite la última posición conocida porque perdió la señal
  if (p.valid === false || p.outdated === true) return { ok: false, motivo: 'Sin señal de GPS' };
  const nudos = num(p.speed);
  return armar(body?.device?.uniqueId, p.latitude, p.longitude, nudos === null ? null : nudos * NUDOS_A_KMH, p.fixTime ?? p.deviceTime, ahora);
}

export function leerOsmand(query: Record<string, any> = {}, body: any = {}, ahora = new Date()): Resultado {
  const loc = body?.location;
  if (loc && typeof loc === 'object' && loc.coords) {
    const ms = num(loc.coords.speed);
    return armar(body.device_id ?? query.id, loc.coords.latitude, loc.coords.longitude, ms === null || ms < 0 ? null : ms * MS_A_KMH, loc.timestamp, ahora);
  }
  // el protocolo viejo manda los parámetros en la dirección (GET) o en el cuerpo de un formulario (POST)
  const d = { ...(body && typeof body === 'object' ? body : {}), ...query };
  const nudos = num(d.speed);
  return armar(d.id ?? d.deviceid, d.lat, d.lon ?? d.lng, nudos === null ? null : nudos * NUDOS_A_KMH, d.timestamp, ahora);
}

export function claveValida(recibida: string | undefined, esperada: string | undefined): boolean {
  if (!esperada) return false;
  const a = Buffer.from(recibida ?? '');
  const b = Buffer.from(esperada);
  return a.length === b.length && timingSafeEqual(a, b);
}
