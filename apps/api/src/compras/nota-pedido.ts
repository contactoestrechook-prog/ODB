// La nota de pedido sin proveedor (Leandro, 10/11/2026): «una nota de pedido
// sin proveedor asignado y que después le podamos asignar el proveedor o
// simplemente exportarla así». Es una lista de { sku, nombre, cantidad }; cada
// renglón puede terminar en un proveedor distinto. Lo que ya se le asignó a un
// proveedor es una orden de compra: la pantalla no lo puede cambiar ni borrar.
export const TOPE_RENGLONES_NOTA = 500;

export type RenglonNota = {
  sku: string;
  nombre: string;
  cantidad: number;
  proveedorId?: string;
  proveedor?: string;
  ordenCompraId?: string;
  ordenNumero?: number;
};

export const asignado = (r: RenglonNota) => !!r.ordenCompraId;

// Lo que manda la pantalla se limpia y se junta por SKU; lo ya asignado sale
// SIEMPRE de lo guardado (la pantalla no lo puede pisar) y va primero.
export function normalizarRenglonesNota(crudo: unknown, guardados: RenglonNota[] = []): RenglonNota[] {
  const fijos = guardados.filter(asignado);
  const salida = new Map<string, RenglonNota>();
  for (const r of Array.isArray(crudo) ? crudo : []) {
    if (!r || typeof r !== 'object') continue;
    const sku = String((r as any).sku ?? '').trim();
    const cantidad = Math.round(Number((r as any).cantidad));
    if (!sku || sku.length > 40 || !Number.isFinite(cantidad) || cantidad <= 0) continue;
    if ((r as any).ordenCompraId) continue; // un asignado que vuelve de la pantalla: vale el guardado
    const previo = salida.get(sku);
    if (previo) { previo.cantidad = Math.min(previo.cantidad + cantidad, 1_000_000); continue; }
    if (fijos.length + salida.size >= TOPE_RENGLONES_NOTA) break;
    salida.set(sku, { sku, nombre: String((r as any).nombre ?? sku).slice(0, 200), cantidad: Math.min(cantidad, 1_000_000) });
  }
  return [...fijos, ...salida.values()];
}

// Los renglones que van a la orden del proveedor: los pedidos que siguen sin
// asignar (sin lista de SKU, todos los que faltan).
export function renglonesParaAsignar(renglones: RenglonNota[], skus?: string[] | null): RenglonNota[] {
  const elegidos = skus?.length ? new Set(skus.map(String)) : null;
  return renglones.filter((r) => !asignado(r) && (!elegidos || elegidos.has(r.sku)));
}

// Después de crear la orden: esos renglones quedan con su proveedor y su número.
export function marcarAsignados(
  renglones: RenglonNota[], skus: string[],
  orden: { proveedorId: string; proveedor: string; ordenCompraId: string; ordenNumero: number | null },
): RenglonNota[] {
  const marcados = new Set(skus);
  return renglones.map((r) => (!asignado(r) && marcados.has(r.sku)
    ? { ...r, proveedorId: orden.proveedorId, proveedor: orden.proveedor, ordenCompraId: orden.ordenCompraId, ...(orden.ordenNumero != null ? { ordenNumero: orden.ordenNumero } : {}) }
    : r));
}

// Cerrada cuando no queda nada sin proveedor y hay algo asignado.
export const notaCompleta = (renglones: RenglonNota[]) => renglones.length > 0 && renglones.every(asignado);
