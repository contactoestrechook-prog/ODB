// LA FACTURA DE UN REMITO YA CARGADO (10/11/2026). Leandro: un solo camino para
// los remitos y que el sistema encuentre solo el remito de la factura, sin
// depender de que alguien tilde «ya se recibió». La mercadería entra UNA vez:
// con el remito. La factura que llega después se carga sola (no suma stock) y
// queda conciliada con ese remito. Se prueba en apps/api/src/compras/remito-factura.spec.ts.
//
// Un remito que entró SIN precio (a $0) no pasa por acá: lo toma «entró sin
// precio» (lib/precio-cero.ts), que le pone el costo de la factura.

export type RemitoEsperando = { id: string; numero: string | null; fecha: string; items: { sku: string; nombre: string; cantidad: number; costo: number }[] };
export type RenglonFactura = { sku: string | null | undefined; cantidad: number };

export type Cruce = {
  remito: RemitoEsperando;
  /** productos que están en los dos */
  coinciden: number;
  /** productos del remito / de la factura */
  enRemito: number;
  enFactura: number;
  /** en la factura y no en el remito: no entraron (o entraron por otro lado) */
  soloFactura: string[];
  /** en el remito y no en la factura */
  soloRemito: string[];
  /** misma cantidad en los que coinciden */
  mismasCantidades: boolean;
};

/** Al menos la mitad de los productos de cada lado tienen que estar en el otro. */
export const MINIMO_COINCIDENCIA = 0.5;

export function remitoDeLaFactura(factura: RenglonFactura[], remitos: RemitoEsperando[]): Cruce | null {
  const fac = new Map<string, number>();
  for (const r of factura) if (r.sku) fac.set(r.sku, (fac.get(r.sku) ?? 0) + (Number(r.cantidad) || 0));
  if (!fac.size) return null;
  let mejor: Cruce | null = null;
  let mejorPuntaje = 0;
  for (const remito of remitos ?? []) {
    // si todo el remito entró a $0, lo resuelve «entró sin precio»
    if (remito.items.length && remito.items.every((i) => !(Number(i.costo) > 0))) continue;
    const rem = new Map<string, { cantidad: number; nombre: string }>();
    for (const i of remito.items) rem.set(i.sku, { cantidad: (rem.get(i.sku)?.cantidad ?? 0) + Number(i.cantidad || 0), nombre: i.nombre });
    if (!rem.size) continue;
    const comunes = [...rem.keys()].filter((s) => fac.has(s));
    const puntaje = Math.min(comunes.length / rem.size, comunes.length / fac.size);
    if (puntaje < MINIMO_COINCIDENCIA || puntaje <= mejorPuntaje) continue;
    mejorPuntaje = puntaje;
    mejor = {
      remito,
      coinciden: comunes.length,
      enRemito: rem.size,
      enFactura: fac.size,
      soloFactura: [...fac.keys()].filter((s) => !rem.has(s)),
      soloRemito: [...rem.keys()].filter((s) => !fac.has(s)).map((s) => rem.get(s)!.nombre),
      mismasCantidades: comunes.every((s) => Math.abs((rem.get(s)!.cantidad) - (fac.get(s) ?? 0)) < 0.001),
    };
  }
  return mejor;
}
