// ENVÍOS A DOMICILIO: lo que necesita el que despacha, armado de una sola vez
// (Leandro, 21/10/2026: «misma basura»). LÓGICA PURA (sin base ni red), así se
// prueba sola.
//
// Antes la pantalla recibía el nombre de la ficha, la dirección y las notas
// crudas. No había teléfono, ni productos, ni cuándo entregar, ni cómo se
// cobra, y nada avisaba que tres pedidos del bot llevaban días en «Recibido» y
// uno de agosto seguía «En camino». Ahora cada envío trae:
// - a quién (la ficha o, si no hay, lo que dejó al comprar) y su WhatsApp;
// - cuándo (fecha y franja) y en qué grupo va: atrasado, para hoy o programado;
// - qué lleva (los renglones) y cómo se cobra (pagado o qué cobrar al entregar);
// - las indicaciones limpias (sin restos de marcado ni la forma de pago, que ya
//   tiene su renglón).

import { sinRestosDeMarcado } from '../comun/texto-limpio';
import { celularWhatsapp } from '../comun/whatsapp';

export const ZONA_HORARIA = 'America/Argentina/Buenos_Aires';

// Cuándo un envío pasa a «Atrasados»
export const HORAS_SIN_MOVERSE = 24; // nadie lo tocó en un día
export const HORAS_EN_LA_CALLE = 12; // salió y nadie lo marcó entregado
// Desde cuándo la pantalla pregunta directo «¿Se entregó o se cancela?»
export const HORAS_PARA_CERRAR = 48;

/** Cómo se puede cobrar en la puerta. Cuenta corriente queda afuera (va por ventas). */
export const MEDIOS_AL_ENTREGAR = ['efectivo', 'tarjeta', 'transferencia'];

export const ESTADOS_ACTIVOS = ['recibido', 'pagado', 'en_preparacion', 'listo', 'en_camino'];

// Las columnas que hacen falta para despachar (Envíos y la vista del repartidor).
export const COLUMNAS_ENVIO = `id, canal, estado, total, qr_retiro, origen, creado_en, pagado_en, preparacion_en, listo_en, en_camino_en,
  notas, forma_pago, entrega_fecha, entrega_franja, destino_direccion, destino_lat, destino_lng, contacto_nombre, contacto_telefono,
  repartidor_id, repartidor_lat, repartidor_lng, repartidor_en,
  sucursal:sucursales(nombre),
  cliente:clientes(nombre, telefono),
  items:pedidos_items(cantidad, precio_unitario, producto:productos(sku, nombre))`;

export type FilaEnvio = {
  id: string;
  canal?: string | null;
  estado: string;
  total: number | string | null;
  qr_retiro?: string | null;
  origen?: string | null;
  creado_en: string;
  pagado_en?: string | null;
  preparacion_en?: string | null;
  listo_en?: string | null;
  en_camino_en?: string | null;
  notas?: string | null;
  forma_pago?: string | null;
  entrega_fecha?: string | null;
  entrega_franja?: string | null;
  destino_direccion?: string | null;
  destino_lat?: number | string | null;
  destino_lng?: number | string | null;
  contacto_nombre?: string | null;
  contacto_telefono?: string | null;
  repartidor_id?: string | null;
  repartidor_lat?: number | string | null;
  repartidor_lng?: number | string | null;
  repartidor_en?: string | null;
  sucursal?: { nombre?: string | null } | null;
  cliente?: { nombre?: string | null; telefono?: string | null } | null;
  items?: { cantidad: number | string; precio_unitario?: number | string | null; producto?: { sku?: string | null; nombre?: string | null } | null }[] | null;
};

export type GrupoEnvio = 'atrasado' | 'hoy' | 'programado';
export type Atraso = { motivo: 'fecha' | 'sin_moverse' | 'en_la_calle'; desde: string; horas: number; texto: string };
export type Cobro = {
  /** Ya está pagado (Mercado Pago) o lo cobra otro (PedidosYa): en la puerta no se cobra nada. */
  pagado: boolean;
  /** Cómo dijo que paga; es lo que se propone al entregar. */
  medio: string | null;
  /** Hay que preguntar en la puerta cómo pagó. */
  preguntar: boolean;
  texto: string;
};

export type Envio = {
  id: string;
  codigo: string;
  estado: string;
  total: number;
  origen: string | null;
  creado_en: string;
  /** Desde cuándo está en el estado en que está. */
  estadoDesde: string;
  sucursal: string | null;
  cliente: { nombre: string | null; telefono: string | null; whatsapp: string | null };
  destino: { direccion: string | null; lat: number | null; lng: number | null };
  entrega: { fecha: string | null; franja: string | null; texto: string };
  cobro: Cobro;
  indicaciones: string | null;
  items: { cantidad: number; nombre: string; sku: string | null; precio: number | null; subtotal: number | null }[];
  repartidor: { id: string; nombre: string } | null;
  enVivo: { distanciaM: number; etaMin: number; actualizado: string | null } | null;
  grupo: GrupoEnvio;
  atraso: Atraso | null;
  /** Atrasado viejo: la pantalla pregunta «¿Se entregó o se cancela?». */
  paraCerrar: boolean;
  // los nombres de antes, para una pantalla vieja mientras se publica la nueva
  qr_retiro: string | null;
  destino_direccion: string | null;
  notas: string | null;
  repartidor_id: string | null;
  repartidor_nombre: string | null;
  distancia_m: number | null;
  etaMin: number | null;
};

// --- fechas en hora de Buenos Aires ------------------------------------------

/** "2026-10-21" del día de Buenos Aires (después de las 21 h, toISOString ya da mañana). */
export function fechaBA(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ZONA_HORARIA }).format(d);
}
// Argentina no tiene horario de verano: el día arranca a las 00:00 -03:00.
const inicioDelDia = (f: string) => Date.parse(`${f}T00:00:00-03:00`);
const diasEntre = (desde: string, hasta: string) => Math.round((inicioDelDia(hasta) - inicioDelDia(desde)) / 86_400_000);
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
/** "martes 14/10" */
export function diaLegible(f: string): string {
  const d = new Date(`${f}T12:00:00Z`);
  return `${DIAS[d.getUTCDay()]} ${d.getUTCDate()}/${d.getUTCMonth() + 1}`;
}
const duracion = (horas: number) => (horas < 48 ? `${Math.max(1, horas)} h` : `${Math.floor(horas / 24)} días`);
const haceDias = (dias: number) => (dias <= 1 ? 'ayer' : `hace ${dias} días`);

// --- en qué grupo va ----------------------------------------------------------

/** Desde cuándo el pedido está en el estado en que está. */
export function estadoDesde(f: Pick<FilaEnvio, 'estado' | 'creado_en' | 'pagado_en' | 'preparacion_en' | 'listo_en' | 'en_camino_en'>): string {
  const porEstado: Record<string, (string | null | undefined)[]> = {
    recibido: [f.creado_en],
    pagado: [f.pagado_en, f.creado_en],
    en_preparacion: [f.preparacion_en, f.pagado_en, f.creado_en],
    listo: [f.listo_en, f.preparacion_en, f.creado_en],
    en_camino: [f.en_camino_en, f.listo_en, f.creado_en],
  };
  return (porEstado[f.estado] ?? [f.creado_en]).find(Boolean) as string;
}

const QUE_PASA: Record<string, string> = {
  recibido: 'Entró',
  pagado: 'Se pagó',
  en_preparacion: 'Se empezó a preparar',
  listo: 'Está listo',
};

/**
 * Atrasado: la fecha de entrega ya pasó, nadie lo movió en 24 h o salió hace
 * más de 12 h y no se marcó entregado. Programado: tiene fecha y no es hoy.
 * Lo demás es para hoy (sin fecha = lo antes posible).
 */
export function clasificar(
  f: Pick<FilaEnvio, 'estado' | 'creado_en' | 'pagado_en' | 'preparacion_en' | 'listo_en' | 'en_camino_en' | 'entrega_fecha'>,
  ahora: Date = new Date(),
): { grupo: GrupoEnvio; atraso: Atraso | null; paraCerrar: boolean } {
  const hoy = fechaBA(ahora);
  const desde = estadoDesde(f);
  const horasDesde = Math.floor((ahora.getTime() - Date.parse(desde)) / 3_600_000);
  const fecha = f.entrega_fecha ? String(f.entrega_fecha).slice(0, 10) : null;

  if (f.estado === 'en_camino') {
    if (horasDesde >= HORAS_EN_LA_CALLE) {
      // salió y nadie lo cerró: lo más probable es que se haya entregado sin marcarlo
      return { grupo: 'atrasado', atraso: { motivo: 'en_la_calle', desde, horas: horasDesde, texto: `Salió hace ${duracion(horasDesde)} y nadie lo marcó entregado` }, paraCerrar: true };
    }
    return { grupo: 'hoy', atraso: null, paraCerrar: false };
  }
  if (fecha && fecha > hoy) return { grupo: 'programado', atraso: null, paraCerrar: false };
  if (fecha && fecha < hoy) {
    // el atraso se cuenta desde que terminó el día pactado
    const finDelDia = new Date(inicioDelDia(fecha) + 86_400_000).toISOString();
    const horas = Math.floor((ahora.getTime() - Date.parse(finDelDia)) / 3_600_000);
    return {
      grupo: 'atrasado',
      atraso: { motivo: 'fecha', desde: finDelDia, horas, texto: `La entrega era el ${diaLegible(fecha)} (${haceDias(diasEntre(fecha, hoy))})` },
      paraCerrar: horas >= HORAS_PARA_CERRAR,
    };
  }
  // sin moverse: para uno pactado para hoy, cuenta desde que empezó el día
  const referencia = fecha === hoy ? new Date(Math.max(Date.parse(desde), inicioDelDia(hoy))).toISOString() : desde;
  const horas = Math.floor((ahora.getTime() - Date.parse(referencia)) / 3_600_000);
  if (horas >= HORAS_SIN_MOVERSE) {
    const que = QUE_PASA[f.estado] ?? 'Está así';
    return {
      grupo: 'atrasado',
      atraso: { motivo: 'sin_moverse', desde: referencia, horas, texto: `${que} hace ${duracion(horas)} y nadie lo movió` },
      paraCerrar: horas >= HORAS_PARA_CERRAR,
    };
  }
  return { grupo: 'hoy', atraso: null, paraCerrar: false };
}

// --- cuándo -------------------------------------------------------------------

const conFranja = (franja: string | null) => (franja ? ` a la ${franja}` : '');

/** "Hoy a la tarde", "Mañana", "jueves 23/10 a la mañana", "Lo antes posible", "Era el martes 14/10". */
export function textoDeEntrega(fecha: string | null | undefined, franja: string | null | undefined, ahora: Date = new Date()): string {
  const fr = franja?.trim() || null;
  if (!fecha) return fr ? `Lo antes posible, a la ${fr}` : 'Lo antes posible';
  const f = String(fecha).slice(0, 10);
  const hoy = fechaBA(ahora);
  const dias = diasEntre(hoy, f);
  if (dias === 0) return `Hoy${conFranja(fr)}`;
  if (dias === 1) return `Mañana${conFranja(fr)}`;
  if (dias < 0) return `Era el ${diaLegible(f)}${conFranja(fr)}`;
  return `${diaLegible(f)}${conFranja(fr)}`;
}

// --- cómo se cobra ------------------------------------------------------------

const NOMBRE_MEDIO: Record<string, string> = {
  efectivo: 'efectivo',
  transferencia: 'transferencia',
  tarjeta: 'tarjeta',
  mercadopago: 'Mercado Pago',
  cuenta_corriente: 'cuenta corriente',
};

export function cobroDe(f: Pick<FilaEnvio, 'qr_retiro' | 'origen' | 'pagado_en' | 'forma_pago'>): Cobro {
  if (String(f.qr_retiro ?? '').startsWith('PY-') || f.origen === 'pedidosya') {
    return { pagado: true, medio: 'pedidosya', preguntar: false, texto: 'Lo cobra PedidosYa' };
  }
  if (f.pagado_en) return { pagado: true, medio: 'mercadopago', preguntar: false, texto: 'Pagado con Mercado Pago' };
  const forma = String(f.forma_pago ?? '').trim() || null;
  if (forma && MEDIOS_AL_ENTREGAR.includes(forma)) {
    return { pagado: false, medio: forma, preguntar: true, texto: `Se cobra al entregar: ${NOMBRE_MEDIO[forma]}` };
  }
  if (forma) {
    // dijo Mercado Pago o cuenta corriente pero el pago no entró: se confirma en la puerta
    return { pagado: false, medio: null, preguntar: true, texto: `Se cobra al entregar (dijo ${NOMBRE_MEDIO[forma] ?? forma}; el pago no entró)` };
  }
  return { pagado: false, medio: null, preguntar: true, texto: 'Se cobra al entregar (no dijo cómo paga)' };
}

/** El medio que se usa al entregar si nadie eligió otro: el que dijo el cliente, si se puede cobrar en la puerta. */
export function medioPorDefecto(formaPago: string | null | undefined): string | null {
  const f = String(formaPago ?? '').trim();
  return MEDIOS_AL_ENTREGAR.includes(f) ? f : null;
}

// --- indicaciones -------------------------------------------------------------

// «Paga en efectivo al recibir.», «Paga con transferencia», «Abona con QR»: ya
// están en el renglón del cobro (pedidos.forma_pago se llena con eso).
const SOLO_PAGO = /^(?:se\s+)?(?:paga|pagan|pago|abona|abonan)\s+(?:con\s+|en\s+|por\s+)?(?:efectivo|transferencia(?:\s+bancaria)?|tarjeta(?:\s+de\s+(?:d[eé]bito|cr[eé]dito))?|d[eé]bito|cr[eé]dito|mercado\s?pago|qr)(?:\s+al\s+(?:recibir|entregar|retirar))?[.!]?$/i;

/** Las notas que sirven para entregar: sin marcado y, si ya se sabe cómo paga, sin la frase del pago. */
export function indicacionesDe(notas: string | null | undefined, formaPago?: string | null): string | null {
  const limpio = sinRestosDeMarcado(notas);
  if (!limpio) return null;
  if (!formaPago) return limpio;
  const partes = limpio
    .split(/(?<=[.!?])\s+|\s+·\s+|\n+/)
    .map((p) => p.trim())
    .filter((p) => p && !SOLO_PAGO.test(p));
  return partes.join(' ') || null;
}

// --- el envío completo --------------------------------------------------------

const numeroONulo = (v: unknown) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

// Distancia entre dos coordenadas en metros (haversine).
function distanciaM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const t = (g: number) => (g * Math.PI) / 180;
  const dLat = t(lat2 - lat1), dLng = t(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(t(lat1)) * Math.cos(t(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}
// Velocidad urbana promedio para estimar cuánto le falta al repartidor (~22 km/h)
const METROS_POR_MIN = 360;

/** El WhatsApp en el formato que espera wa.me (549 + 10 dígitos), o null si no sirve. */
export function whatsappDe(crudo: unknown): string | null {
  const d = celularWhatsapp(String(crudo ?? ''));
  return /^549\d{10}$/.test(d) ? d : null;
}

export function armarEnvio(f: FilaEnvio, { ahora = new Date(), nombres = new Map<string, string>() }: { ahora?: Date; nombres?: Map<string, string> } = {}): Envio {
  const { grupo, atraso, paraCerrar } = clasificar(f, ahora);
  const telefono = String(f.cliente?.telefono || f.contacto_telefono || '').trim() || null;
  const nombre = sinRestosDeMarcado(f.cliente?.nombre, { unaLinea: true }) || sinRestosDeMarcado(f.contacto_nombre, { unaLinea: true }) || null;
  const direccion = sinRestosDeMarcado(f.destino_direccion, { unaLinea: true }) || null;
  const lat = numeroONulo(f.destino_lat), lng = numeroONulo(f.destino_lng);
  const rLat = numeroONulo(f.repartidor_lat), rLng = numeroONulo(f.repartidor_lng);
  let enVivo: Envio['enVivo'] = null;
  if (f.estado === 'en_camino' && rLat != null && rLng != null && lat != null && lng != null) {
    const distanciaMetros = distanciaM(rLat, rLng, lat, lng);
    enVivo = { distanciaM: distanciaMetros, etaMin: Math.max(1, Math.round(distanciaMetros / METROS_POR_MIN)), actualizado: f.repartidor_en ?? null };
  }
  const repartidorNombre = f.repartidor_id ? nombres.get(String(f.repartidor_id)) ?? 'Alguien del equipo' : null;
  const items = (f.items ?? []).map((i) => {
    const cantidad = Number(i.cantidad) || 0;
    const precio = numeroONulo(i.precio_unitario);
    return {
      cantidad,
      nombre: sinRestosDeMarcado(i.producto?.nombre, { unaLinea: true }) || 'Producto',
      sku: i.producto?.sku ?? null,
      precio,
      subtotal: precio != null ? Math.round(cantidad * precio * 100) / 100 : null,
    };
  });
  const notas = sinRestosDeMarcado(f.notas) || null;
  return {
    id: f.id,
    codigo: f.qr_retiro || f.id.slice(0, 8).toUpperCase(),
    estado: f.estado,
    total: Number(f.total) || 0,
    origen: f.origen ?? null,
    creado_en: f.creado_en,
    estadoDesde: estadoDesde(f),
    sucursal: f.sucursal?.nombre ?? null,
    cliente: { nombre, telefono, whatsapp: whatsappDe(telefono) },
    destino: { direccion, lat, lng },
    entrega: { fecha: f.entrega_fecha ? String(f.entrega_fecha).slice(0, 10) : null, franja: f.entrega_franja ?? null, texto: textoDeEntrega(f.entrega_fecha, f.entrega_franja, ahora) },
    cobro: cobroDe(f),
    indicaciones: indicacionesDe(f.notas, f.forma_pago),
    items,
    repartidor: f.repartidor_id ? { id: String(f.repartidor_id), nombre: repartidorNombre as string } : null,
    enVivo,
    grupo,
    atraso,
    paraCerrar,
    qr_retiro: f.qr_retiro ?? null,
    destino_direccion: direccion,
    notas,
    repartidor_id: f.repartidor_id ?? null,
    repartidor_nombre: repartidorNombre,
    distancia_m: enVivo?.distanciaM ?? null,
    etaMin: enVivo?.etaMin ?? null,
  };
}

const ORDEN_GRUPO: Record<GrupoEnvio, number> = { atrasado: 0, hoy: 1, programado: 2 };
const ORDEN_ESTADO: Record<string, number> = { recibido: 0, pagado: 0, en_preparacion: 1, listo: 2, en_camino: 3 };
const ORDEN_FRANJA: Record<string, number> = { mañana: 0, tarde: 1 };

/** Atrasados primero (el más viejo arriba); después hoy y programados, por estado, fecha y franja. */
export function ordenarEnvios(lista: Envio[]): Envio[] {
  return [...lista].sort((a, b) =>
    ORDEN_GRUPO[a.grupo] - ORDEN_GRUPO[b.grupo]
    || (a.grupo === 'atrasado' ? Date.parse(a.atraso?.desde ?? a.creado_en) - Date.parse(b.atraso?.desde ?? b.creado_en) : 0)
    || (ORDEN_ESTADO[a.estado] ?? 9) - (ORDEN_ESTADO[b.estado] ?? 9)
    || String(a.entrega.fecha ?? '').localeCompare(String(b.entrega.fecha ?? ''))
    || (ORDEN_FRANJA[a.entrega.franja ?? ''] ?? 2) - (ORDEN_FRANJA[b.entrega.franja ?? ''] ?? 2)
    || Date.parse(a.creado_en) - Date.parse(b.creado_en),
  );
}

// --- el aviso al cliente ------------------------------------------------------

/**
 * El WhatsApp al cliente en cada paso. Antes, un envío a domicilio marcado
 * «listo» le decía «Lo esperamos en la sucursal Saint Thomas»: el texto no
 * miraba el canal.
 */
export function avisoAlCliente(p: { canal?: string | null; qr_retiro?: string | null }, estado: string): string | null {
  const codigo = p.qr_retiro ? ` (${p.qr_retiro})` : '';
  const domicilio = p.canal === 'domicilio';
  if (estado === 'listo') {
    return domicilio
      ? `Su pedido de O.D.B${codigo} ya está preparado. En breve sale hacia su domicilio.`
      : `Su pedido de O.D.B está listo para retirar.${p.qr_retiro ? ` Código: ${p.qr_retiro}.` : ''} Lo esperamos en la sucursal Saint Thomas (Castex 3601).`;
  }
  if (estado === 'en_camino') return `Su pedido de O.D.B${codigo} salió y está en camino a su domicilio.`;
  if (estado === 'entregado') return `Su pedido de O.D.B${codigo} fue entregado. Gracias por su compra.`;
  return null;
}
