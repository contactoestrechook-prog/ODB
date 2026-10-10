// ============================================================
// FACTURAS QUE PONEN PRECIO A LO QUE ENTRÓ A $0 (10/10/2026, pedido de Leandro)
//
// «Cuando cargamos facturas de La Serenísima, en la parte de quesos figuran los
// que ingresaron a precio 0, y a la semana llega otra factura con los precios
// de esos quesos; tenemos que poder identificarlas para no duplicar stock.»
//
// La primera factura (o la pistola) entra los quesos con costo 0. La segunda,
// cargada como compra normal, los volvía a sumar. Ahora, al cargar una factura,
// se buscan las entradas a $0 de ESE proveedor de los últimos 45 días que
// todavía no tienen precio; el renglón que coincide le pone el costo a esa
// entrada y NO suma stock (lo hace la base: recibir_compra_valorizando).
// ============================================================

export const DIAS_PRECIO_CERO = 45;

/** Una orden (directa o no) con sus renglones, como la trae la consulta. */
export type OcCandidata = {
  id: string;
  numero: number | null;
  proveedor_id: string;
  creado_en: string;
  items: { producto_id: string; cantidad_recibida: number | string | null; costo_unitario: number | string | null; producto?: { sku: string; nombre: string } | null }[] | null;
};

export type PendientePrecioCero = {
  ocId: string;
  ocNumero: number | null;
  productoId: string;
  sku: string;
  nombre: string;
  cantidad: number; // lo que entró a $0
  fecha: string; // YYYY-MM-DD: cuándo entró
  comprobante: { tipo: 'factura' | 'remito' | 'orden'; numero: string };
};

const num = (v: unknown) => (v == null || v === '' || !Number.isFinite(Number(v)) ? 0 : Number(v));

/**
 * Las entradas a $0 de un proveedor que esperan precio: costo 0, algo recibido,
 * de los últimos `dias`, sin valorizar y que no hayan sido un regalo (si el
 * papel de esa entrada traía precio para el producto, era sin cargo: entró a
 * cero a propósito y la próxima compra suma stock como siempre).
 * Ordenadas de la más vieja a la más nueva.
 */
export function pendientesPrecioCero(d: {
  proveedorId: string;
  hoy: Date;
  ocs: OcCandidata[];
  remitos?: { oc_id: string; numero: string | null; creado_en: string }[];
  facturas?: { oc_id: string; numero: string | null; estado?: string | null }[];
  valorizadas?: { oc_id: string; producto_id: string }[];
  historial?: { numero: string | null; producto_id: string | null; precio: number | string | null }[];
  dias?: number;
}): PendientePrecioCero[] {
  const desde = d.hoy.getTime() - (d.dias ?? DIAS_PRECIO_CERO) * 86_400_000;
  const yaValorizada = new Set((d.valorizadas ?? []).map((v) => `${v.oc_id}|${v.producto_id}`));
  const conPrecioEnElPapel = new Set(
    (d.historial ?? []).filter((h) => h.producto_id && h.numero && num(h.precio) > 0).map((h) => `${h.numero}|${h.producto_id}`),
  );
  const salida: PendientePrecioCero[] = [];
  for (const oc of d.ocs ?? []) {
    if (oc.proveedor_id !== d.proveedorId) continue;
    // cuándo entró: el primer remito de la orden; si no tiene, la orden
    const remitos = (d.remitos ?? []).filter((r) => r.oc_id === oc.id).sort((a, b) => a.creado_en.localeCompare(b.creado_en));
    const entro = remitos[0]?.creado_en ?? oc.creado_en;
    if (!(Date.parse(entro) >= desde)) continue;
    const factura = (d.facturas ?? []).find((f) => f.oc_id === oc.id && f.numero && f.estado !== 'anulada');
    const remito = remitos.find((r) => r.numero);
    const comprobante: PendientePrecioCero['comprobante'] = factura
      ? { tipo: 'factura', numero: String(factura.numero) }
      : remito
        ? { tipo: 'remito', numero: String(remito.numero) }
        : { tipo: 'orden', numero: String(oc.numero ?? '') };
    const numerosDelPapel = [factura?.numero, ...remitos.map((r) => r.numero)].filter(Boolean) as string[];
    for (const it of oc.items ?? []) {
      if (num(it.costo_unitario) !== 0 || !(num(it.cantidad_recibida) > 0) || !it.producto?.sku) continue;
      if (yaValorizada.has(`${oc.id}|${it.producto_id}`)) continue;
      if (numerosDelPapel.some((n) => conPrecioEnElPapel.has(`${n}|${it.producto_id}`))) continue;
      salida.push({
        ocId: oc.id,
        ocNumero: oc.numero ?? null,
        productoId: it.producto_id,
        sku: it.producto.sku,
        nombre: it.producto.nombre,
        cantidad: num(it.cantidad_recibida),
        fecha: entro.slice(0, 10),
        comprobante,
      });
    }
  }
  return salida.sort((a, b) => a.fecha.localeCompare(b.fecha));
}

/**
 * Separa los renglones de una entrada: los que traen `valorizaOc` (el usuario
 * dejó tildado «solo precio») le ponen costo a esa entrada a $0 y no suman
 * stock; el resto entra como siempre.
 */
export function separarValorizaciones<T extends { valorizaOc?: string | null }>(items: T[]): { normales: T[]; valorizar: T[] } {
  const normales: T[] = [];
  const valorizar: T[] = [];
  for (const i of items ?? []) (String(i.valorizaOc ?? '').trim() ? valorizar : normales).push(i);
  return { normales, valorizar };
}
