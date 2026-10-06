// Los textos de los avisos al teléfono de administración (regla de Leandro,
// 3/10/2026: "las confirmaciones salen al teléfono de administración"). Todo se
// arma en el momento de mandarlo, con el pedido ya grabado entero (renglones,
// total, dirección), no en el trigger.
//
// Cada aviso empieza con un encabezado fijo ("PEDIDO NUEVO · PICKUP-…"): así se
// distingue de los otros avisos del chat (pagos, consultas) y es lo que se busca
// antes de reintentar, para no mandarlo dos veces.

import { cuandoLegible } from '../comun/cuando';

export type TipoAviso = 'pedido_nuevo' | 'pedido_cancelado' | 'pedido_pagado' | 'pedido_sin_cargar' | 'pedido_sin_tomar';

export type PedidoParaAviso = {
  id: string;
  qr_retiro: string | null;
  canal: string;
  estado: string;
  total: number;
  creado_en: string;
  notas: string | null;
  destino_direccion: string | null;
  entrega_fecha: string | null;
  entrega_franja: string | null;
  pagado_en: string | null;
  cliente: { nombre: string | null; telefono: string | null } | null;
  /** lo que dejó quien compró sin cuenta en la web o la app (6/10/2026) */
  contacto?: { nombre: string | null; telefono: string | null } | null;
  /** por dónde entró, si el pedido lo tiene grabado (web/app se distinguen recién desde el 6/10/2026) */
  origen?: string | null;
  /** quién lo tomó en el panel ("Lo tomo") */
  tomadoPor?: string | null;
  /** el teléfono real del cliente (si el chat es un @lid de WhatsApp) */
  telefonoReal: string | null;
  items: { nombre: string; cantidad: number; precio_unitario: number }[];
  /** lo confirmó el bot de WhatsApp (tiene cotización del bot) */
  esDelBot: boolean;
  /**
   * el bot lo confirmó por el comprobante de una transferencia: lo que quedó en
   * bot_cotizaciones.confirmacion («comprobante: $285.390»). null si no.
   */
  confirmadoPorComprobante?: string | null;
};

const ZONA = 'America/Argentina/Buenos_Aires';
const pesos = (n: number) => Math.round(Number(n) || 0).toLocaleString('es-AR');
const hora = (iso: string) => new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: ZONA });
const diaBA = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: ZONA }).format(d);

/** "a las 10:10" si fue hoy; "ayer a las 23:50" o "el vie 2/10 a las 18:51" si no. */
export function cuandoFue(iso: string, ahora = new Date()): string {
  const d = new Date(iso);
  if (diaBA(d) === diaBA(ahora)) return `a las ${hora(iso)}`;
  if (diaBA(d) === diaBA(new Date(ahora.getTime() - 86400_000))) return `ayer a las ${hora(iso)}`;
  const semana = d.toLocaleDateString('es-AR', { weekday: 'short', timeZone: ZONA }).replace(/[.,]/g, '');
  const [, mes, dia] = diaBA(d).split('-').map(Number);
  return `el ${semana} ${dia}/${mes} a las ${hora(iso)}`;
}

/** Por dónde entró: el canal solo no alcanza ('web' es PedidosYa o Tiendanube). */
export function origenDelPedido(p: Pick<PedidoParaAviso, 'qr_retiro' | 'canal' | 'esDelBot'> & { origen?: string | null }): 'bot' | 'pedidosya' | 'tiendanube' | 'panel' | 'web' | 'app' | 'tienda' | 'otro' {
  const qr = String(p.qr_retiro ?? '');
  if (p.esDelBot) return 'bot';
  if (p.origen === 'web' || p.origen === 'app') return p.origen;
  if (qr.startsWith('PY-')) return 'pedidosya';
  if (qr.startsWith('TN-')) return 'tiendanube';
  if (qr.startsWith('WA-') || p.canal === 'whatsapp') return 'panel';
  // sin origen grabado (pedidos de antes del 6/10/2026) no se sabe si fue la web o la app
  if (/^(PICKUP|DOM)-/.test(qr)) return 'tienda';
  return 'otro';
}

const NOMBRE_ORIGEN: Record<ReturnType<typeof origenDelPedido>, string> = {
  bot: 'el WhatsApp de la casa (bot)',
  pedidosya: 'PedidosYa',
  tiendanube: 'Tiendanube',
  panel: 'el panel (pedido por WhatsApp cargado a mano)',
  web: 'la tienda web',
  app: 'la app',
  tienda: 'la tienda web o la app',
  otro: 'otro canal',
};

/** "5491135901236" → "+54 9 11 3590-1236". Un @lid (14 dígitos o más) no es un teléfono: null. */
export function telefonoLegible(numero: string | null | undefined): string | null {
  const d = String(numero ?? '').replace(/\D/g, '');
  if (!d || d.length >= 14) return null;
  const m = d.match(/^549(11|\d{3})(\d{3,4})(\d{4})$/);
  return m ? `+54 9 ${m[1]} ${m[2]}-${m[3]}` : `+${d}`;
}

export function codigoDe(p: Pick<PedidoParaAviso, 'qr_retiro' | 'id'>): string {
  return p.qr_retiro || p.id.slice(0, 8).toUpperCase();
}

const TITULOS: Record<TipoAviso, string> = {
  pedido_nuevo: 'PEDIDO NUEVO',
  pedido_cancelado: 'PEDIDO CANCELADO',
  pedido_pagado: 'PEDIDO PAGADO',
  pedido_sin_cargar: 'PEDIDO CONFIRMADO SIN CARGAR',
  pedido_sin_tomar: 'PEDIDO SIN TOMAR',
};

/** El link al pedido en el panel: tocándolo desde el WhatsApp se abre con el botón "Lo tomo". */
export function linkDelPedido(id: string): string {
  return `${(process.env.ADMIN_URL ?? 'https://odb-admin-production.up.railway.app').replace(/\/$/, '')}/pedidos?pedido=${id}`;
}

/** El encabezado fijo con que empieza cada aviso ("PEDIDO NUEVO · PICKUP-…"). */
export function encabezado(tipo: TipoAviso, referencia: string): string {
  return `${TITULOS[tipo]} · ${referencia}`;
}

function clienteDe(p: PedidoParaAviso): string {
  const tel = telefonoLegible(p.telefonoReal) ?? telefonoLegible(p.cliente?.telefono) ?? telefonoLegible(p.contacto?.telefono);
  return [p.cliente?.nombre?.trim() || p.contacto?.nombre?.trim(), tel].filter(Boolean).join(' · ');
}

function renglonesDe(p: PedidoParaAviso): string[] {
  return p.items.length
    ? p.items.map((i) => `• ${Number(i.cantidad).toLocaleString('es-AR', { maximumFractionDigits: 3 })} × ${i.nombre} — $${pesos(Number(i.cantidad) * Number(i.precio_unitario))}`)
    : ['• (sin productos cargados: revisar el pedido)'];
}

/** Cómo se entrega, según por dónde entró. */
function entregaDe(p: PedidoParaAviso): string {
  const origen = origenDelPedido(p);
  const cuando = cuandoLegible(p.entrega_fecha, p.entrega_franja);
  if (origen === 'pedidosya') return 'Lo retira el repartidor de PedidosYa.';
  if (origen === 'tiendanube') return 'Pedido de Tiendanube: la entrega figura en Tiendanube.';
  if (p.canal === 'domicilio') return `Envío a ${p.destino_direccion?.trim() || 'DIRECCIÓN SIN CARGAR (revisar)'}${cuando ? `, ${cuando}` : ''}.`;
  return `Retiro en la sucursal Saint Thomas${cuando ? `, ${cuando}` : ', sin día pedido (lo antes posible)'}.`;
}

/** Cómo se cobra: solo el bot pacta "se abona al retirar"; la web y la app pueden estar pagando por Mercado Pago. */
function cobroDe(p: PedidoParaAviso): string {
  const origen = origenDelPedido(p);
  if (p.pagado_en) return 'Ya está pagado.';
  // EL QUE YA TRANSFIRIÓ NO PAGA DOS VECES (5/10/2026, revisión): el pedido que
  // confirmó el comprobante decía «Se cobra al retirar» y la nota «se cobra
  // $285.390»; el cajero le volvía a cobrar a Pablo, que ya había transferido.
  const comprobante = /^comprobante:\s*(\$\s?[\d.,]+)/i.exec(String(p.confirmadoPorComprobante ?? ''));
  if (origen === 'bot' && comprobante) {
    const momento = p.canal === 'domicilio' ? 'recibir' : 'retirar';
    return `YA TRANSFIRIÓ ${comprobante[1]} por WhatsApp (a confirmar por administración): si está acreditada NO se cobra nada al ${momento}; si no, se cobran ${comprobante[1]}.`;
  }
  if (origen === 'pedidosya') return 'Lo cobra PedidosYa.';
  if (origen === 'tiendanube') return 'El pago figura en Tiendanube: revisalo antes de cobrar.';
  if (origen === 'bot' || origen === 'panel') return `Se cobra al ${p.canal === 'domicilio' ? 'recibir' : 'retirar'}.`;
  return 'Todavía no figura pagado: puede estar pagándolo por Mercado Pago. Antes de cobrar, mirá el pedido en el panel.';
}

/** El aviso de un pedido nuevo. Con `conRenglones`, también los productos (cuando no va la tarjeta). */
export function textoDelAviso(p: PedidoParaAviso, opciones: { conRenglones: boolean; ahora?: Date; antesSinCargar?: boolean }): string {
  const cliente = clienteDe(p);
  return [
    encabezado('pedido_nuevo', codigoDe(p)),
    // el mismo pedido ya había llegado como PEDIDO CONFIRMADO SIN CARGAR: que no lo carguen dos veces
    opciones.antesSinCargar ? 'Es el pedido que antes llegó como CONFIRMADO SIN CARGAR: ya quedó cargado, NO lo carguen a mano.' : null,
    `Entró por ${NOMBRE_ORIGEN[origenDelPedido(p)]} ${cuandoFue(p.creado_en, opciones.ahora)}.`,
    entregaDe(p),
    `Cliente: ${cliente || 'sin datos (compra sin cuenta)'}`,
    ...(opciones.conRenglones ? renglonesDe(p) : []),
    `Total: $${pesos(p.total)}. ${cobroDe(p)}`,
    p.notas?.trim() ? `Notas: ${p.notas.trim().slice(0, 300)}` : null,
    // quién lo recibe queda anotado (6/10/2026): el link abre el pedido en el panel con "Lo tomo"
    `Tomalo acá: ${linkDelPedido(p.id)}`,
  ].filter(Boolean).join('\n');
}

/** A los 15 minutos (de horario de atención) nadie lo tomó: UN reclamo, nunca más. */
export function textoDeSinTomar(p: PedidoParaAviso, ahora = new Date()): string {
  const minutos = Math.max(1, Math.round((ahora.getTime() - Date.parse(p.creado_en)) / 60000));
  const hace = minutos < 90 ? `hace ${minutos} min` : `hace ${Math.round(minutos / 60)} h`;
  return [
    encabezado('pedido_sin_tomar', codigoDe(p)),
    `Entró ${cuandoFue(p.creado_en, ahora)} (${hace}) y nadie lo tomó todavía.`,
    entregaDe(p),
    clienteDe(p) ? `Cliente: ${clienteDe(p)}` : null,
    `Total: $${pesos(p.total)}.`,
    `Tomalo acá: ${linkDelPedido(p.id)}`,
  ].filter(Boolean).join('\n');
}

export function textoDeCancelado(p: PedidoParaAviso): string {
  return [
    encabezado('pedido_cancelado', codigoDe(p)),
    'El pedido se canceló: no lo preparen. Si ya está armado, desármenlo (el sistema ya devolvió el stock).',
    `Era: ${p.items.map((i) => `${Number(i.cantidad).toLocaleString('es-AR', { maximumFractionDigits: 3 })} × ${i.nombre}`).join(', ') || 'sin productos'} — $${pesos(p.total)}.`,
    clienteDe(p) ? `Cliente: ${clienteDe(p)}` : null,
  ].filter(Boolean).join('\n');
}

export function textoDePagado(p: PedidoParaAviso): string {
  return [
    encabezado('pedido_pagado', codigoDe(p)),
    `Se pagó ${p.pagado_en ? cuandoFue(p.pagado_en) : ''} por Mercado Pago: no hay que cobrarlo al ${p.canal === 'domicilio' ? 'recibir' : 'retirar'}.`.replace(/\s{2,}/g, ' '),
    `Total: $${pesos(p.total)}.`,
  ].join('\n');
}

export type SinCargar = { telefono: string; telefonoReal: string | null; nombre?: string | null; nota: string; resumen: string | null; aviso?: string | null };

/** El cliente confirmó por WhatsApp y el pedido no se pudo cargar: hay que cargarlo a mano. */
export function textoDeSinCargar(s: SinCargar): string {
  // un chat @lid sin teléfono conocido: el id tal como lo muestra RESPONDE, para encontrarlo
  const tel = telefonoLegible(s.telefonoReal) ?? telefonoLegible(s.telefono) ?? `chat +${String(s.telefono).replace(/\D/g, '')}`;
  // el encabezado lleva un número propio de cada aviso: con el teléfono solo,
  // el reintento de un segundo pedido sin cargar del mismo chat encontraba el primero
  const numero = s.aviso ? ` · #${s.aviso.replace(/-/g, '').slice(0, 6).toUpperCase()}` : '';
  return [
    encabezado('pedido_sin_cargar', `${tel}${numero}`),
    'El cliente confirmó un pedido por WhatsApp y el sistema NO lo pudo cargar. Hay que cargarlo a mano y confirmarle por el chat.',
    s.nombre?.trim() ? `Cliente: ${s.nombre.trim()}` : null,
    s.resumen ? `Lo último que se le cotizó:\n${s.resumen.replace(/\n?¿Lo confirmo\?\s*$/i, '').trim()}` : null,
    `Detalle: ${s.nota.slice(0, 600)}`,
  ].filter(Boolean).join('\n');
}

/** Espera antes del próximo intento: 15 s, 30 s, 1, 2, 4, 8 min y después cada 10 min. */
export function esperaParaReintentar(intentos: number): number {
  return Math.min(15_000 * 2 ** Math.max(0, intentos - 1), 10 * 60_000);
}

/** Espera antes de volver a intentar avisarles a los dueños: 1, 2, 4… hasta 30 min. */
export function esperaParaEscalar(intentos: number): number {
  return Math.min(60_000 * 2 ** Math.max(0, intentos), 30 * 60_000);
}

/** El id largo de un mensaje propio ("true_549…@c.us_3EB0…"), para preguntarle a WhatsApp si llegó. */
export function idLargoDeMensaje(chatId: string, id: string): string {
  const s = String(id ?? '');
  return s.includes('_') ? s : `true_${chatId}_${s}`;
}

/** El ack de WhatsApp: 2 (DEVICE) o más es que llegó al teléfono. -1 es error. */
export const LLEGO = (ack: number | null | undefined) => Number(ack) >= 2;

/** Minutos sin salir antes de avisar a los dueños, y sin llegar al teléfono. */
export const MINUTOS_SIN_SALIR = 3;
export const MINUTOS_SIN_LLEGAR = 15;

/** Teléfonos de prueba: el simulador del panel ("Probar el bot") usa 11 + 8 dígitos. */
export const esTelefonoDePrueba = (telefono: string | null | undefined) => /^11\d{8}$/.test(String(telefono ?? ''));
