// EL ALIAS, CON EL PEDIDO LISTO (Leandro, 21/11/2026). El cliente de
// DOM-1284BEF14D1D pidió el alias apenas confirmó, transfirió $118.200 y al
// armar faltaba la leche: se enojó, canceló y hubo que devolverle la plata.
// Desde ahora, el que pide el alias con un pedido en curso recibe «el alias te
// llega cuando tu pedido esté listo» y le llega solo, con el total final,
// en el aviso de «listo». Lógica pura: sin base ni red.
import { conDescuentoEfectivo, tieneDescuentoEfectivo } from '../bot/descuento-efectivo';

const pesos = (n: number) => `$${Math.round(n).toLocaleString('es-AR')}`;

/** La respuesta al «¿me pasás el alias?» mientras el pedido se arma (o todavía no se confirmó). */
export function aliasAlListo(codigo?: string | null): string {
  return codigo
    ? `El alias te llega cuando tu pedido ${codigo} esté listo, con el total final.`
    : 'El alias te llega cuando tu pedido esté listo, con el total final.';
}

/**
 * La forma de pago que dicen las notas, con el criterio de la base
 * (forma_pago_de_texto): gana la que aparece primero. Mercado Pago no cuenta acá.
 */
export function formaDePagoDeNotas(notas: string | null | undefined): 'efectivo' | 'transferencia' | 'tarjeta' | null {
  const s = String(notas ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const candidatas: ['efectivo' | 'transferencia' | 'tarjeta' | 'mercadopago', RegExp][] = [
    ['efectivo', /\befectivo/], ['transferencia', /\btransf/], ['mercadopago', /\bmercado ?pago|\bqr\b/], ['tarjeta', /\b(?:tarjeta|debito|credito)/],
  ];
  let mejor: { f: string; i: number } | null = null;
  for (const [f, re] of candidatas) {
    const i = s.search(re);
    if (i >= 0 && (!mejor || i < mejor.i)) mejor = { f, i };
  }
  return mejor && mejor.f !== 'mercadopago' ? (mejor.f as 'efectivo' | 'transferencia' | 'tarjeta') : null;
}

/** ¿El pedido se arma todavía? Con «listo» o «en camino», el total ya es el final. */
export const ESTADOS_ANTES_DE_LISTO = ['recibido', 'en_preparacion'];
export const ESTADOS_LISTO = ['listo', 'en_camino'];

type ConfigPago = { alias_pago?: string | null; cbu_pago?: string | null; titular_pago?: string | null; banco_pago?: string | null } | null | undefined;

/** «Alias: x · CBU: y · Titular: z (Banco)», o null si la línea no tiene alias cargado. */
export function datosParaTransferir(cfg: ConfigPago): string | null {
  const t = (v: unknown) => String(v ?? '').trim();
  const alias = t(cfg?.alias_pago);
  if (!alias) return null;
  const cbu = t(cfg?.cbu_pago);
  const titular = t(cfg?.titular_pago);
  const banco = t(cfg?.banco_pago);
  return `Alias: ${alias}${cbu ? ` · CBU: ${cbu}` : ''}${titular ? ` · Titular: ${titular}` : ''}${banco ? ` (${banco})` : ''}`;
}

/**
 * ¿Le corresponde el alias al quedar listo? Paga por transferencia y no pagó
 * todavía. Mercado Pago y PedidosYa ya vienen pagados.
 */
export function pasaAliasAlListo(p: { forma_pago?: string | null; pagado_en?: string | null; origen?: string | null; qr_retiro?: string | null }): boolean {
  return p.forma_pago === 'transferencia' && !p.pagado_en && p.origen !== 'pedidosya' && !String(p.qr_retiro ?? '').startsWith('PY-');
}

export type RenglonParaTransferir = { cantidad: number | string; precio_unitario: number | string; categoria?: string | null };

/**
 * Lo que se transfiere: el total del pedido menos el descuento de efectivo o
 * transferencia de cada renglón que lo tiene (vinos, destilados…, el mismo
 * cálculo que el bot al cotizar). Al mayorista no se le descuenta.
 */
export function totalPorTransferencia(total: number, renglones: RenglonParaTransferir[], mayorista = false): number {
  const t = Math.round(Number(total) || 0);
  if (mayorista) return t;
  const descuento = renglones.reduce((s, r) => {
    if (!tieneDescuentoEfectivo(r.categoria)) return s;
    const subtotal = Math.round(Number(r.precio_unitario) * Number(r.cantidad) * 100) / 100;
    return s + Math.max(0, subtotal - conDescuentoEfectivo(subtotal));
  }, 0);
  return Math.max(0, Math.round(t - descuento));
}

/** El monto, con el de lista al lado si la transferencia tiene descuento. */
function montoATransferir(total: number, totalTransferencia: number): string {
  return totalTransferencia < Math.round(total) ? `${pesos(totalTransferencia)} (con el descuento por transferencia)` : pesos(total);
}

/** El renglón con el alias: total a transferir, datos y qué hacer después. */
export function bloqueDeAlias(o: { total: number; totalTransferencia: number; datos: string }): string {
  return `Total a transferir: ${montoATransferir(o.total, o.totalTransferencia)}.\n${o.datos.replace(/\.\s*$/, '')}.\nCuando transfieras, mandame el comprobante por acá.`;
}

/**
 * El aviso de «listo» para el que paga por transferencia: en vos, como el bot,
 * y con el alias abajo.
 */
export function avisoListoConAlias(
  p: { canal?: string | null; qr_retiro?: string | null },
  o: { total: number; totalTransferencia: number; datos: string },
  estado = 'listo',
): string {
  const codigo = p.qr_retiro ? ` ${p.qr_retiro}` : '';
  const arriba = estado === 'en_camino'
    ? `Tu pedido${codigo} ya salió y está en camino a tu domicilio.`
    : p.canal === 'domicilio'
      ? `Tu pedido${codigo} ya está listo y en breve sale hacia tu domicilio.`
      : `Tu pedido${codigo} ya está listo para retirar en la sucursal Saint Thomas (Castex 3601).`;
  return `${arriba}\n\n${bloqueDeAlias(o)}`;
}
