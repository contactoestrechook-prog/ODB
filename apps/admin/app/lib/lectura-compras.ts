/** Valida campos editables sin convertir un vacío en cero o una unidad. */
export function camposDeLecturaIncompletos(i: { cantidad?: unknown; precio?: unknown; esDescuento?: boolean }): boolean {
  const numero = (v: unknown) => (typeof v === 'number' || typeof v === 'string') && String(v).trim() !== '' && Number.isFinite(Number(v));
  return !numero(i.cantidad) || Number(i.cantidad) <= 0 || !numero(i.precio) || (!i.esDescuento && Number(i.precio) < 0);
}

// ============================================================
// LO QUE EL PAPEL NO ENTREGA NI COBRA NO ES UN RENGLÓN (18/11/2026).
// Nini 1200-00049128: debajo de cada producto en oferta imprime «Promocion
// 0145993» con cantidad 0 y sin importe (solo el precio unitario con la rebaja,
// como referencia). La rebaja de verdad viene al final, en su propio renglón.
// La pantalla los mostraba como renglones a completar («falta la cantidad»),
// trababan el registro y el chat no los podía sacar: Anabella escribió dos veces
// «no tomes los renglones que dicen promoción».
//
// Regla: cantidad 0 escrita, sin precio y sin importe → no entrega nada y no
// cobra nada, así que no se carga. No es una rebaja ni una devolución (esas
// tienen importe). Se dice en un cartel cuáles se dejaron afuera, por si fuera
// un renglón mal leído. Se prueba en apps/api/src/compras/rebaja-no-aplicada.spec.ts.
// ============================================================
type RenglonLeido = { cantidad?: unknown; precio?: unknown; importe?: unknown; esDescuento?: boolean; esDevolucion?: boolean; interpretado?: { cantidad?: unknown } | null };

const ceroEscrito = (v: unknown) => v != null && String(v).trim() !== '' && Number(v) === 0;
const ceroOVacio = (v: unknown) => v == null || String(v).trim() === '' || Number(v) === 0;

export function noEntregaNiCobra(i: RenglonLeido): boolean {
  if (!i || i.esDescuento || i.esDevolucion) return false;
  const cantidad = i.interpretado?.cantidad ?? i.cantidad;
  return ceroEscrito(cantidad) && ceroEscrito(i.cantidad ?? cantidad) && ceroOVacio(i.precio) && ceroOVacio(i.importe);
}

export function separarRenglonesSinNada<T extends RenglonLeido>(items: T[]): { renglones: T[]; sinNada: T[] } {
  const renglones: T[] = [];
  const sinNada: T[] = [];
  for (const i of items ?? []) (noEntregaNiCobra(i) ? sinNada : renglones).push(i);
  return { renglones, sinNada };
}
