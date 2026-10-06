// Lo que dicen del pedido la ventana emergente, la pantalla de Pedidos y su
// detalle (6/10/2026): una sola fuente para que las tres digan lo mismo.

import type { TonoEtiqueta } from '../ui/kit';

export type PedidoCola = {
  id: string;
  canal: string;
  estado: string;
  total: number | string;
  qr_retiro: string | null;
  creado_en: string;
  pagado_en?: string | null;
  notas?: string | null;
  entrega_fecha?: string | null;
  entrega_franja?: string | null;
  entregaEtiqueta?: string | null;
  programado?: boolean;
  destino_direccion?: string | null;
  origen?: string | null;
  clienteNombre?: string | null;
  clienteTelefono?: string | null;
  cliente?: { dni?: string | null; tipo?: string | null } | null;
  tomado_por?: string | null;
  tomado_en?: string | null;
  tomadoPorNombre?: string | null;
  repartidorNombre?: string | null;
  minutos?: number;
  items?: { cantidad: number | string; precio_unitario?: number | string | null; producto?: { sku?: string; nombre?: string } | null }[];
};

export const ORIGENES: Record<string, { label: string; tono: TonoEtiqueta }> = {
  bot: { label: 'WhatsApp (bot)', tono: 'ok' },
  panel: { label: 'Cargado a mano', tono: 'neutro' },
  whatsapp: { label: 'Cargado a mano', tono: 'neutro' },
  web: { label: 'Tienda web', tono: 'info' },
  app: { label: 'App', tono: 'info' },
  pedidosya: { label: 'PedidosYa', tono: 'error' },
  tiendanube: { label: 'Tiendanube', tono: 'info' },
  // pedidos de antes del 6/10/2026 sin origen grabado
  pickup: { label: 'Web o app', tono: 'info' },
  domicilio: { label: 'Web o app', tono: 'info' },
  mostrador: { label: 'Mostrador', tono: 'neutro' },
};
export const origenDe = (p: Pick<PedidoCola, 'origen' | 'canal'>) => ORIGENES[String(p.origen ?? p.canal)] ?? { label: String(p.origen ?? p.canal), tono: 'neutro' as TonoEtiqueta };

export const ESTADOS: Record<string, { label: string; tono: TonoEtiqueta }> = {
  recibido: { label: 'Nuevo', tono: 'atencion' },
  pagado: { label: 'Nuevo · pagado', tono: 'atencion' },
  en_preparacion: { label: 'En preparación', tono: 'info' },
  listo: { label: 'Listo', tono: 'ok' },
  en_camino: { label: 'En camino', tono: 'info' },
  entregado: { label: 'Entregado', tono: 'ok' },
  cancelado: { label: 'Cancelado', tono: 'error' },
};

export const esDomicilio = (p: Pick<PedidoCola, 'canal'>) => p.canal === 'domicilio';

/** "Retira en Saint Thomas · HOY · mañana" o "Envío a Av. Mate 123 · …" */
export function entregaDe(p: PedidoCola): string {
  const cuando = p.entregaEtiqueta ? ` · ${p.entregaEtiqueta}` : '';
  if (String(p.qr_retiro ?? '').startsWith('PY-') || p.origen === 'pedidosya') return 'Lo retira PedidosYa';
  if (esDomicilio(p)) return `Envío a ${p.destino_direccion?.trim() || 'dirección sin cargar'}${cuando}`;
  return `Retira en Saint Thomas${cuando || ' · lo antes posible'}`;
}

/** "5491123456789" → "11 2345-6789"; un @lid o algo raro → null. */
export function telefonoLegible(numero: string | null | undefined): string | null {
  const d = String(numero ?? '').replace(/\D/g, '');
  if (!d || d.length >= 14) return null;
  const m = d.match(/^(?:549)?(11|\d{3})(\d{3,4})(\d{4})$/);
  return m ? `${m[1]} ${m[2]}-${m[3]}` : `+${d}`;
}

/** Link para escribirle por WhatsApp (abre la app o WhatsApp Web). */
export function linkWhatsapp(numero: string | null | undefined): string | null {
  const d = String(numero ?? '').replace(/\D/g, '');
  if (!d || d.length >= 14 || d.length < 10) return null;
  return `https://wa.me/${d.startsWith('54') ? d : `549${d}`}`;
}

export const codigoDe = (p: Pick<PedidoCola, 'qr_retiro' | 'id'>) => p.qr_retiro || p.id.slice(0, 8).toUpperCase();

/** "hace 4 min", "hace 2 h", "ayer 18:40", "3/10 13:10" */
export function haceCuanto(iso: string | null | undefined, ahora = Date.now()): string {
  if (!iso) return '';
  const m = Math.max(0, Math.round((ahora - Date.parse(iso)) / 60000));
  if (m < 1) return 'recién';
  if (m < 60) return `hace ${m} min`;
  if (m < 12 * 60) return `hace ${Math.round(m / 60)} h`;
  return new Date(iso).toLocaleString('es-AR', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Argentina/Buenos_Aires' });
}

export function cantidadLegible(c: number | string): string {
  const n = Number(c) || 0;
  return n.toLocaleString('es-AR', { maximumFractionDigits: 3 });
}

export type Paso = { estado: string; label: string };
export function siguientePaso(p: PedidoCola): Paso | null {
  if (['recibido', 'pagado'].includes(p.estado)) return { estado: 'en_preparacion', label: 'Empezar a preparar' };
  if (p.estado === 'en_preparacion') return { estado: 'listo', label: 'Marcar listo' };
  if (p.estado === 'listo') return esDomicilio(p) ? { estado: 'en_camino', label: 'Despachar' } : { estado: 'entregado', label: 'Entregado' };
  if (p.estado === 'en_camino') return { estado: 'entregado', label: 'Entregado' };
  return null;
}

/** ¿Hay que preguntar cómo pagó al entregarlo? No, si ya está pagado por Mercado Pago o es de PedidosYa. */
export const pideMedioAlEntregar = (p: PedidoCola) => !p.pagado_en && !String(p.qr_retiro ?? '').startsWith('PY-') && p.origen !== 'pedidosya';

export const sinTomar = (p: PedidoCola) => !p.tomado_por && ['recibido', 'pagado'].includes(p.estado);
