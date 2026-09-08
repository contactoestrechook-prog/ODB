// Cómo terminó la caja: los pagos de la sesión agrupados por medio (y por
// posnet cuando hay más de uno). Es lo que se muestra en el cierre y se imprime.
export const ETIQUETA_MEDIO: Record<string, string> = {
  efectivo: 'Efectivo',
  mercadopago: 'Mercado Pago (QR)',
  tarjeta: 'Tarjeta',
  transferencia: 'Transferencia',
  cuenta_corriente: 'Cuenta corriente',
  ctacte: 'Cuenta corriente',
};
const ETIQUETA_TERMINAL: Record<string, string> = { getnet: 'Getnet', clover: 'Clover', posnet: 'Posnet' };

export type PagoSesion = { medio: string; monto: number | string; terminal?: string | null };

export function etiquetaMedio(medio: string, terminal?: string | null): string {
  const base = ETIQUETA_MEDIO[medio] ?? (medio ? medio.charAt(0).toUpperCase() + medio.slice(1).replace(/_/g, ' ') : 'Otro');
  if (terminal) return `${base} · ${ETIQUETA_TERMINAL[terminal] ?? terminal}`;
  return base;
}

export function agruparPorMedio(pagos: PagoSesion[]): { clave: string; medio: string; terminal: string | null; etiqueta: string; monto: number; pagos: number }[] {
  const m = new Map<string, { clave: string; medio: string; terminal: string | null; etiqueta: string; monto: number; pagos: number }>();
  for (const p of pagos) {
    const medio = String(p.medio ?? 'otro');
    const terminal = p.terminal ? String(p.terminal) : null;
    const clave = terminal ? `${medio}:${terminal}` : medio;
    const acc = m.get(clave) ?? { clave, medio, terminal, etiqueta: etiquetaMedio(medio, terminal), monto: 0, pagos: 0 };
    acc.monto += Number(p.monto) || 0;
    acc.pagos += 1;
    m.set(clave, acc);
  }
  // efectivo primero, después el resto de mayor a menor
  return [...m.values()]
    .map((x) => ({ ...x, monto: Math.round(x.monto * 100) / 100 }))
    .sort((a, b) => (a.medio === 'efectivo' ? -1 : b.medio === 'efectivo' ? 1 : b.monto - a.monto));
}
