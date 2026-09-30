/** Valida campos editables sin convertir un vacío en cero o una unidad. */
export function camposDeLecturaIncompletos(i: { cantidad?: unknown; precio?: unknown; esDescuento?: boolean }): boolean {
  const numero = (v: unknown) => (typeof v === 'number' || typeof v === 'string') && String(v).trim() !== '' && Number.isFinite(Number(v));
  return !numero(i.cantidad) || Number(i.cantidad) <= 0 || !numero(i.precio) || (!i.esDescuento && Number(i.precio) < 0);
}
