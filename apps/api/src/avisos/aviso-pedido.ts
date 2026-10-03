// El texto del aviso de un pedido nuevo al teléfono de administración (regla de
// Leandro, 3/10/2026: "las confirmaciones salen al teléfono de administración").
// Todo lo que sale acá se arma en el momento de mandarlo, con el pedido ya
// grabado entero (renglones, total, dirección), no en el trigger.

import { cuandoLegible } from '../comun/cuando';

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
  /** el teléfono real del cliente (si el chat es un @lid de WhatsApp) */
  telefonoReal: string | null;
  items: { nombre: string; cantidad: number; precio_unitario: number }[];
  /** lo confirmó el bot de WhatsApp (tiene cotización del bot) */
  esDelBot: boolean;
};

const pesos = (n: number) => Math.round(Number(n) || 0).toLocaleString('es-AR');

/** Por dónde entró: el canal solo no alcanza ('web' es PedidosYa o Tiendanube). */
export function origenDelPedido(p: Pick<PedidoParaAviso, 'qr_retiro' | 'canal' | 'esDelBot'>): string {
  const qr = String(p.qr_retiro ?? '');
  if (p.esDelBot) return 'el WhatsApp de la casa (bot)';
  if (qr.startsWith('PY-')) return 'PedidosYa';
  if (qr.startsWith('TN-')) return 'Tiendanube';
  if (qr.startsWith('WA-') || p.canal === 'whatsapp') return 'el panel (pedido por WhatsApp cargado a mano)';
  if (/^(PICKUP|DOM)-/.test(qr)) return 'la tienda web o la app';
  return `el canal ${p.canal}`;
}

/** "5491135901236" → "+54 9 11 3590-1236". Lo que no es un celular argentino queda como vino. */
export function telefonoLegible(numero: string | null | undefined): string | null {
  const d = String(numero ?? '').replace(/\D/g, '');
  if (!d) return null;
  const m = d.match(/^549(11|\d{3})(\d{3,4})(\d{4})$/);
  return m ? `+54 9 ${m[1]} ${m[2]}-${m[3]}` : `+${d}`;
}

/** "PEDIDO NUEVO · PICKUP-…" y lo que hace falta para prepararlo. Con `conRenglones`, también los productos (cuando no va la tarjeta). */
export function textoDelAviso(p: PedidoParaAviso, opciones: { conRenglones: boolean }): string {
  const codigo = p.qr_retiro || p.id.slice(0, 8).toUpperCase();
  const hora = new Date(p.creado_en).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Argentina/Buenos_Aires' });
  const domicilio = p.canal === 'domicilio';
  const cuando = cuandoLegible(p.entrega_fecha, p.entrega_franja);
  const entrega = domicilio
    ? `Envío a ${p.destino_direccion?.trim() || 'DIRECCIÓN SIN CARGAR (revisar)'}${cuando ? `, ${cuando}` : ''}.`
    : `Retiro en la sucursal Saint Thomas${cuando ? `, ${cuando}` : ''}.`;
  const tel = telefonoLegible(p.telefonoReal) ?? (String(p.cliente?.telefono ?? '').replace(/\D/g, '').length <= 13 ? telefonoLegible(p.cliente?.telefono) : null);
  const cliente = [p.cliente?.nombre?.trim(), tel].filter(Boolean).join(' · ');
  const renglones = opciones.conRenglones
    ? (p.items.length
        ? p.items.map((i) => `• ${Number(i.cantidad).toLocaleString('es-AR', { maximumFractionDigits: 3 })} × ${i.nombre} — $${pesos(Number(i.cantidad) * Number(i.precio_unitario))}`)
        : ['• (sin productos cargados: revisar el pedido)'])
    : [];
  const cobro = p.pagado_en ? 'Ya está pagado.' : `Se cobra al ${domicilio ? 'recibir' : 'retirar'}.`;
  return [
    `PEDIDO NUEVO · ${codigo}`,
    `Entró por ${origenDelPedido(p)} a las ${hora}.`,
    entrega,
    `Cliente: ${cliente || 'sin datos (compra sin cuenta)'}`,
    ...renglones,
    `Total: $${pesos(p.total)}. ${cobro}`,
    p.notas?.trim() ? `Notas: ${p.notas.trim().slice(0, 300)}` : null,
  ].filter(Boolean).join('\n');
}

/** Espera antes del próximo intento: 15 s, 30 s, 1, 2, 4, 8 min y después cada 10 min. */
export function esperaParaReintentar(intentos: number): number {
  return Math.min(15_000 * 2 ** Math.max(0, intentos - 1), 10 * 60_000);
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
