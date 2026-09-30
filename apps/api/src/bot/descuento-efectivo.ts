// DESCUENTO POR PAGO EN EFECTIVO O TRANSFERENCIA (Leandro, 30/9/2026): 10% en
// vinos, destilados, aperitivos, estuchería y espumantes. El precio del sistema
// es el de lista (tarjeta); el bot informa los dos, y el precio con descuento lo
// calcula el código, nunca el modelo. DESCUENTO_EFECTIVO (en %) lo cambia sin
// tocar código; en 0 lo apaga.

export const RUBROS_DESCUENTO_EFECTIVO = 'vinos, destilados, aperitivos, estuchería y espumantes';

export function porcentajeEfectivo(): number {
  const p = Number(process.env.DESCUENTO_EFECTIVO ?? 10);
  return Number.isFinite(p) && p > 0 && p < 100 ? p : 0;
}

// categorías de la base que entran (nombres tal cual están cargados). Licores,
// sidra, cavas y "Alcohol" quedan afuera hasta que el dueño confirme.
const RE_RUBRO = /^(vinos?\b|anadas antiguas$|espumantes?\b|estucheria$|aperitivos$|whisk(?:y|ies)$|gin$|vodka$|ron$|tequila$|destilados$)/;

export function tieneDescuentoEfectivo(categoria: string | null | undefined): boolean {
  if (!porcentajeEfectivo()) return false;
  const c = String(categoria ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  return RE_RUBRO.test(c);
}

/** Precio pagando en efectivo o transferencia, redondeado a pesos. */
export function conDescuentoEfectivo(precio: number): number {
  return Math.round(precio * (1 - porcentajeEfectivo() / 100));
}
