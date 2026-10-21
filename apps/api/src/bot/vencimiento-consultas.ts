// ============================================================
// LA CONSULTA SIN RESPUESTA PASA SOLA A UNA PERSONA (Leandro, 21/10/2026: «si»)
//
// La consulta silenciosa (6/10/2026): lo que el bot no sabe se le pregunta a
// administración y al cliente no se le dice nada; la respuesta del área le llega
// como mensaje final. Del 15 al 21/10 administración contestó 2 de 94: el cliente
// esperaba algo que nunca llegaba, y solo pasaba a una persona si insistía.
//
// Ahora, si la consulta lleva MINUTOS_PARA_VENCER minutos DE HORARIO DE ATENCIÓN
// sin respuesta del área y sin que nadie de la casa le haya escrito al cliente,
// pasa sola a una persona: al cliente le llega UNA vez «Te paso con una persona
// del local.» (la frase de la derivación por insistencia), el bot queda en pausa
// en esa charla y al local le llega el aviso por la campanita y por WhatsApp al
// teléfono de administración. Fuera de horario no se le escribe a nadie: los
// minutos corren desde que abre la sucursal.
//
// Lo usa el vigía de consultas (seguirConsultasPendientes, cada 5 min). Acá está
// solo la decisión, con funciones puras y sus pruebas en vencimiento-consultas.spec.ts.
// ============================================================
import { escritoPorUnaPersona, loUltimoDeLaCasaEsDeUnaPersona, MINUTOS_CONSULTA_SIN_RESPUESTA, type MensajeDelHilo, nombraAAlguienDeLaCasa, pideCompra } from './silencio';

/** Minutos de horario de atención que una consulta espera al área antes de pasar a una persona. */
export const MINUTOS_PARA_VENCER = MINUTOS_CONSULTA_SIN_RESPUESTA;
/**
 * Pasado este tiempo de horario sin haber vencido (el servidor estuvo caído, la columna
 * todavía no estaba en la base), ya no se le escribe al cliente: llegaría tarde. Sin este
 * tope, al publicar, las 95 consultas viejas sin respuesta le habrían escrito a 95 clientes
 * de días atrás.
 */
export const MINUTOS_MAXIMOS_PARA_VENCER = 120;
/** Hasta cuándo se reintenta el WhatsApp a administración de una consulta vencida si no salió. */
export const HORAS_REINTENTO_AVISO = 6;

// ---- el horario de atención ----
// Argentina no cambia la hora desde 2009: Buenos Aires es UTC−3 todo el año (la
// base calcula lo mismo con 'America/Argentina/Buenos_Aires' en estado_atencion()).
const DESFASE_BA_MS = -3 * 3600_000;
const DIA_MS = 24 * 3600_000;

/** Una sucursal como está en la base (sucursales): abre/cierra de siempre y lo que cambia por día (19/10/2026). */
export type HorarioSucursal = {
  nombre?: string | null;
  pickup?: boolean | null;
  abre?: string | null;
  cierra?: string | null;
  /** 0 = domingo … 6 = sábado; sin dato, todos los días */
  dias_abierta?: number[] | null;
  /** {"0":{"cierra":"14:00"}}: el día que no figura usa abre/cierra */
  horario_por_dia?: Record<string, { abre?: string | null; cierra?: string | null }> | null;
};

/**
 * El horario que cuenta: el de la sucursal de donde salen los pedidos de WhatsApp (pickup,
 * Saint Thomas); si ninguna está marcada, el de todas las activas juntas.
 */
export function horarioDeAtencion(sucursales: HorarioSucursal[] | null | undefined): HorarioSucursal[] {
  const conHorario = (sucursales ?? []).filter((s) => s && aMinutos(s.abre) !== null && aMinutos(s.cierra) !== null);
  const pickup = conHorario.filter((s) => s.pickup === true);
  return pickup.length ? pickup : conHorario;
}

/** «08:30» / «08:30:00» → minutos desde la medianoche; null si no se entiende. */
function aMinutos(h: string | null | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(h ?? '').trim());
  if (!m) return null;
  const n = Number(m[1]) * 60 + Number(m[2]);
  return n >= 0 && n <= 24 * 60 ? n : null;
}

/** Los tramos abiertos (en ms, hora real) de los días que tocan [desde, hasta], unidos entre sucursales. */
function tramosAbiertos(horario: HorarioSucursal[], desde: number, hasta: number): [number, number][] {
  const tramos: [number, number][] = [];
  // medianoche de Buenos Aires del día de `desde`, y un tope de 15 días (no hace falta más)
  const primerDia = Math.floor((desde + DESFASE_BA_MS) / DIA_MS) * DIA_MS - DESFASE_BA_MS;
  for (let dia = primerDia, n = 0; dia <= hasta && n < 15; dia += DIA_MS, n++) {
    const dow = new Date(dia + DESFASE_BA_MS).getUTCDay();
    for (const s of horario) {
      const dias = Array.isArray(s.dias_abierta) && s.dias_abierta.length ? s.dias_abierta.map(Number) : [0, 1, 2, 3, 4, 5, 6];
      if (!dias.includes(dow)) continue;
      const delDia = s.horario_por_dia?.[String(dow)] ?? null;
      const abre = aMinutos(delDia?.abre) ?? aMinutos(s.abre);
      const cierra = aMinutos(delDia?.cierra) ?? aMinutos(s.cierra);
      if (abre === null || cierra === null || cierra <= abre) continue;
      tramos.push([dia + abre * 60_000, dia + cierra * 60_000]);
    }
  }
  // dos sucursales abiertas a la vez son un solo tramo
  tramos.sort((a, b) => a[0] - b[0]);
  const unidos: [number, number][] = [];
  for (const t of tramos) {
    const u = unidos[unidos.length - 1];
    if (u && t[0] <= u[1]) u[1] = Math.max(u[1], t[1]);
    else unidos.push([t[0], t[1]]);
  }
  return unidos;
}

/** ¿Está abierta la sucursal en este instante? (abre ≤ ahora < cierra) */
export function abiertaAhora(horario: HorarioSucursal[], ahora: number): boolean {
  return tramosAbiertos(horario, ahora, ahora).some(([a, z]) => a <= ahora && ahora < z);
}

/** Minutos de horario de atención entre `desde` y `hasta` (lo que pasa con el local cerrado no cuenta). */
export function minutosDeHorario(horario: HorarioSucursal[], desde: number, hasta: number): number {
  if (!(hasta > desde)) return 0;
  let ms = 0;
  for (const [a, z] of tramosAbiertos(horario, desde, hasta)) ms += Math.max(0, Math.min(z, hasta) - Math.max(a, desde));
  return Math.floor(ms / 60_000);
}

// ---- la decisión ----
export type ConsultaParaVencer = {
  id?: string;
  creado_en: string;
  consulta?: string | null;
  respuesta_admin?: string | null;
  respondido_en?: string | null;
  vencida_en?: string | null;
  enviado_a?: string | null;
  gestion_version?: number | null;
};
export type CharlaParaVencer = {
  bot_activo?: boolean | null;
  derivada_en?: string | null;
  derivada_motivo?: string | null;
  resuelta_en?: string | null;
  mensajes?: MensajeDelHilo[] | null;
} | null | undefined;
export type ContactoParaVencer = { tipo?: string | null; es_equipo?: boolean | null; etiquetas?: string[] | null } | null | undefined;

/**
 * Lo que se mira sin leer nada más que la consulta: ¿ya está en su momento de vencer?
 * Devuelve el motivo para NO vencerla, o null. Fuera de horario, nunca; antes de los 30
 * minutos de horario, todavía no; pasados los 120, tarde (no se le escribe al cliente).
 */
export function aunNoVence(c: ConsultaParaVencer, horario: HorarioSucursal[], ahora: number): string | null {
  if (c.vencida_en) return 'ya pasó a una persona';
  if (c.respondido_en) return 'la consulta está cerrada';
  if (c.respuesta_admin) return 'el área ya respondió';
  if (c.gestion_version != null && Number(c.gestion_version) !== 2) return 'consulta del circuito viejo';
  if (c.enviado_a === 'banco-de-pruebas') return 'banco de pruebas';
  const creada = Date.parse(String(c.creado_en ?? ''));
  if (!Number.isFinite(creada) || creada > ahora) return 'sin fecha de creación';
  if (!horario.length) return 'sin horario de atención cargado';
  if (!abiertaAhora(horario, ahora)) return 'fuera de horario';
  const min = minutosDeHorario(horario, creada, ahora);
  if (min < MINUTOS_PARA_VENCER) return `lleva ${min} min de horario`;
  if (min > MINUTOS_MAXIMOS_PARA_VENCER) return `lleva ${min} min de horario: ya es tarde para escribirle`;
  return null;
}

// el modelo nombra así a quien escribe cuando no es un cliente («El proveedor MUGE…», «Proveedor por una factura:»)
const RE_PROVEEDOR = /\bproveedor(?:a|es)?\b/i;

/**
 * Con la charla y el contacto a la vista: ¿algo impide pasarla a una persona? Devuelve el
 * motivo, o null si vence. No vence si el bot ya está en pausa en esa charla, si se derivó
 * (o la pausó alguien) después de la consulta, si una persona de la casa escribió después de
 * la consulta o lleva la charla, si es un proveedor, alguien de la casa o un contacto
 * silenciado, si la consulta es un mensaje para alguien de la casa, o si alguien la cerró
 * con «Listo» en la campanita.
 */
export function impideVencer(o: {
  consulta: ConsultaParaVencer;
  charla: CharlaParaVencer;
  contacto: ContactoParaVencer;
  /** número del equipo, otra línea o un área de la casa */
  deLaCasa?: boolean;
  /** alguien tocó «Listo» en un aviso de esta consulta en la campanita */
  cerradaEnLaCampanita?: boolean;
  ahora: number;
}): string | null {
  const creada = Date.parse(String(o.consulta.creado_en ?? ''));
  const ch = o.charla;
  if (ch?.bot_activo === false) return 'el bot está en pausa en esa charla';
  const derivada = Date.parse(String(ch?.derivada_en ?? ''));
  if (Number.isFinite(derivada) && derivada >= creada) return 'la charla ya se derivó o se pausó después de la consulta';
  const hilo = Array.isArray(ch?.mensajes) ? ch!.mensajes! : [];
  if (hilo.some((m) => escritoPorUnaPersona(m) && Date.parse(String(m.en ?? '')) >= creada)) return 'una persona de la casa le escribió después de la consulta';
  // lo último que le dijo la casa lo escribió una persona hace poco (sin devolverla al bot a mano): la lleva ella
  const resuelta = Date.parse(String(ch?.resuelta_en ?? ''));
  const volvioSolo = /volvi[oó] solo/i.test(String(ch?.derivada_motivo ?? ''));
  if (loUltimoDeLaCasaEsDeUnaPersona(hilo, { ahora: o.ahora, devueltaAlBotEn: Number.isFinite(resuelta) && !volvioSolo ? resuelta : null }).length) return 'la charla la lleva una persona de la casa';
  const k = o.contacto;
  if (k?.tipo === 'proveedor') return 'es un proveedor';
  if (k?.es_equipo || o.deLaCasa) return 'es alguien de la casa';
  if (Array.isArray(k?.etiquetas) && k!.etiquetas!.some((e) => String(e).toLowerCase() === 'silenciado')) return 'contacto silenciado';
  const texto = String(o.consulta.consulta ?? '');
  if (RE_PROVEEDOR.test(texto)) return 'la consulta es de un proveedor';
  if (nombraAAlguienDeLaCasa(texto) && !pideCompra(texto)) return 'la consulta es un mensaje para alguien de la casa';
  if (o.cerradaEnLaCampanita) return 'alguien la cerró con «Listo» en la campanita';
  return null;
}
