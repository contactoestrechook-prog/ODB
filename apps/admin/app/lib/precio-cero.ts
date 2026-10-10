// Facturas que ponen precio a lo que entró a $0 (10/10/2026). La API dice qué
// entradas a $0 de este proveedor esperan precio (GET compras/precio-cero); acá
// se elige cuál le corresponde a cada producto de la factura y se arma el
// texto del renglón. Se prueba en apps/api/src/compras/precio-cero.spec.ts.

export type PendientePrecioCero = {
  ocId: string;
  ocNumero: number | null;
  productoId: string;
  sku: string;
  nombre: string;
  cantidad: number;
  fecha: string; // YYYY-MM-DD
  comprobante: { tipo: 'factura' | 'remito' | 'orden'; numero: string };
};

/**
 * Una entrada a $0 por producto de la factura. Si el mismo producto tiene
 * varias esperando, va la que entró con la misma cantidad; si ninguna, la más
 * vieja. Una entrada no se asigna dos veces.
 */
export function elegirPendientes(
  renglones: { sku?: string | null; cantidad: number | string }[],
  pendientes: PendientePrecioCero[],
): Record<string, PendientePrecioCero> {
  const cantidadPorSku = new Map<string, number>();
  for (const r of renglones ?? []) {
    if (!r?.sku) continue;
    cantidadPorSku.set(r.sku, (cantidadPorSku.get(r.sku) ?? 0) + (Number(r.cantidad) || 0));
  }
  const libres = [...(pendientes ?? [])].sort((a, b) => a.fecha.localeCompare(b.fecha));
  const salida: Record<string, PendientePrecioCero> = {};
  for (const [sku, cantidad] of cantidadPorSku) {
    const delSku = libres.filter((p) => p.sku === sku);
    if (!delSku.length) continue;
    const elegida = delSku.find((p) => Math.abs(p.cantidad - cantidad) < 0.0005) ?? delSku[0];
    salida[sku] = elegida;
    libres.splice(libres.indexOf(elegida), 1);
  }
  return salida;
}

const fechaCorta = (iso: string) => {
  const [, m, d] = String(iso ?? '').slice(0, 10).split('-');
  return d && m ? `${d}/${m}` : iso;
};
const cant = (n: number) => n.toLocaleString('es-AR', { maximumFractionDigits: 3 });

/** «Entró a $0 el 03/10 (factura N° 0001-123): solo precio, no suma stock» */
export function textoPrecioCero(p: PendientePrecioCero): string {
  const papel = p.comprobante.tipo === 'orden' ? `OC #${p.comprobante.numero}` : `${p.comprobante.tipo} N° ${p.comprobante.numero}`;
  return `Entró a $0 el ${fechaCorta(p.fecha)} (${papel}): solo precio, no suma stock`;
}

/** Si la factura trae otra cantidad (quesos por peso): se valoriza igual y el stock no se toca. */
export function diferenciaPrecioCero(p: PendientePrecioCero, cantidadFactura: number): string | null {
  const c = Number(cantidadFactura) || 0;
  if (Math.abs(c - p.cantidad) < 0.0005) return null;
  return `Entraron ${cant(p.cantidad)} y la factura dice ${cant(c)}: queda anotado, el stock no se toca.`;
}
