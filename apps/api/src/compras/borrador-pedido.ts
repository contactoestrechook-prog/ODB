// El borrador del pedido a proveedor (4/11/2026): { sku: cantidad }, como lo
// escribe la pantalla. Lo que no sea un SKU con una cantidad entera positiva se
// descarta en silencio (un 0 es «sacarlo del pedido»); tope de 2.000 renglones,
// que es más que la lista más larga que hay.
export const TOPE_RENGLONES_BORRADOR = 2000;

export function normalizarBorradorPedido(crudo: unknown): Record<string, number> {
  const salida: Record<string, number> = {};
  if (!crudo || typeof crudo !== 'object' || Array.isArray(crudo)) return salida;
  for (const [sku, valor] of Object.entries(crudo as Record<string, unknown>)) {
    const s = String(sku).trim();
    const n = Math.round(Number(valor));
    if (!s || s.length > 40 || !Number.isFinite(n) || n <= 0) continue;
    salida[s] = Math.min(n, 1_000_000);
    if (Object.keys(salida).length >= TOPE_RENGLONES_BORRADOR) break;
  }
  return salida;
}
