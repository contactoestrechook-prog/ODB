// ============================================================
// LO QUE NOS VENDE CADA PROVEEDOR (8/10/2026). Leandro: «cada vez que una
// factura ingresa el sistema tiene que ir guardando todos los productos que
// ese proveedor trabaja, para luego en la mesa de compras tener info valiosa».
//
// Cada factura registrada deja sus renglones en compras_historial (también los
// que no se vincularon a un producto de la casa). Acá se resume, por proveedor,
// qué productos trae, a cuánto, cada cuánto y en qué cantidades. Lo usan la
// pestaña «Proveedores» de la mesa de compras y el Analista.
// ============================================================

/** Un renglón de factura tal como quedó guardado. */
export type RenglonHistorial = {
  producto_id: string | null;
  numero: string | null;
  fecha: string; // YYYY-MM-DD
  codigo_proveedor: string | null;
  descripcion: string;
  unidades_por_bulto: number | null;
  unidades: number | null;
  precio: number | null; // unitario del papel, antes de la bonificación
  bonificacion_pct: number | null;
  importe: number | null;
  costo_unitario: number | null; // por unidad de stock, con IVA y percepciones
  es_descuento: boolean;
};

/** Lo que ya se sabía del vínculo proveedor → producto (proveedor_productos). */
export type VinculoProveedor = {
  producto_id: string;
  codigo_proveedor: string | null;
  ultimo_costo: number | null;
  actualizado_en: string | null;
};

export type DatosProducto = { id: string; sku: string; nombre: string; plu?: string | null; codigo_legacy?: string | null };

export type ProductoDelProveedor = {
  sku: string;
  codigo: string | null; // el PLU / código de la casa
  nombre: string;
  codigoProveedor: string | null;
  compras: number; // facturas distintas en las que vino
  primeraCompra: string | null;
  ultimaCompra: string | null;
  ultimoPrecio: number | null; // neto del papel: precio × (1 − bonificación)
  precioAnterior: number | null; // el de la compra anterior
  variacionPct: number | null;
  bonificacionPct: number | null; // la de la última compra
  unidadesPorBulto: number | null;
  unidadesTotales: number;
  promedioPorCompra: number | null;
  cadaCuantosDias: number | null;
  costoUnitario: number | null; // el último costo final por unidad de stock
  soloVinculo: boolean; // se sabe que lo trabaja (lista de precios, recepción) pero no hay factura leída
};

export type LineaSinVincular = {
  descripcion: string;
  codigoProveedor: string | null;
  compras: number;
  ultimaCompra: string;
  ultimoPrecio: number | null;
  bonificacionPct: number | null;
  unidadesTotales: number;
};

export type ResumenProveedor = {
  comprobantes: number;
  primeraCompra: string | null;
  ultimaCompra: string | null;
  netoComprado: number;
  productos: ProductoDelProveedor[];
  sinVincular: LineaSinVincular[];
};

const num = (v: unknown): number | null => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const redondear = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
const dias = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

/** El código de la casa: el PLU; si no, el del sistema viejo; si no, el del sku (L10578 → 10578). */
export function codigoDeLaCasa(p: { plu?: string | null; codigo_legacy?: string | null; sku?: string | null } | null | undefined): string | null {
  if (!p) return null;
  const directo = String(p.plu ?? '').trim() || String(p.codigo_legacy ?? '').trim();
  if (directo) return directo.replace(/^0+(?=\d)/, '');
  const m = String(p.sku ?? '').trim().match(/^L?(\d+)$/i);
  return m ? m[1].replace(/^0+(?=\d)/, '') : null;
}

/** Precio neto del papel: el unitario menos la bonificación del renglón. */
export function precioNeto(r: Pick<RenglonHistorial, 'precio' | 'bonificacion_pct'>): number | null {
  const p = num(r.precio);
  if (p == null) return null;
  return redondear(p * (1 - Math.min(100, Math.abs(num(r.bonificacion_pct) ?? 0)) / 100));
}

const claveCompra = (r: RenglonHistorial) => `${r.numero ?? ''}|${r.fecha}`;

export function resumirProveedor(renglones: RenglonHistorial[], vinculos: VinculoProveedor[], productos: Map<string, DatosProducto>): ResumenProveedor {
  const merc = renglones.filter((r) => !r.es_descuento);
  const fechas = merc.map((r) => r.fecha).sort();
  const comprobantes = new Set(merc.map(claveCompra)).size;

  // por producto, de la compra más nueva a la más vieja
  const porProducto = new Map<string, RenglonHistorial[]>();
  for (const r of merc) {
    if (!r.producto_id) continue;
    (porProducto.get(r.producto_id) ?? porProducto.set(r.producto_id, []).get(r.producto_id)!).push(r);
  }
  const vinculoDe = new Map(vinculos.map((v) => [v.producto_id, v]));

  const lista: ProductoDelProveedor[] = [];
  for (const [id, filas] of porProducto) {
    const p = productos.get(id);
    if (!p) continue;
    filas.sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0));
    const compras = [...new Set(filas.map(claveCompra))];
    const ultima = filas[0];
    const anterior = filas.find((f) => claveCompra(f) !== claveCompra(ultima));
    const ultimoPrecio = precioNeto(ultima);
    const precioAnterior = anterior ? precioNeto(anterior) : null;
    const unidadesTotales = redondear(filas.reduce((s, f) => s + (num(f.unidades) ?? 0), 0), 3);
    const primera = filas[filas.length - 1].fecha;
    lista.push({
      sku: p.sku,
      codigo: codigoDeLaCasa(p),
      nombre: p.nombre,
      codigoProveedor: filas.find((f) => f.codigo_proveedor)?.codigo_proveedor ?? vinculoDe.get(id)?.codigo_proveedor ?? null,
      compras: compras.length,
      primeraCompra: primera,
      ultimaCompra: ultima.fecha,
      ultimoPrecio,
      precioAnterior,
      variacionPct: ultimoPrecio != null && precioAnterior ? redondear(((ultimoPrecio - precioAnterior) / precioAnterior) * 100, 1) : null,
      bonificacionPct: num(ultima.bonificacion_pct),
      unidadesPorBulto: filas.map((f) => num(f.unidades_por_bulto)).find((x) => x != null && x > 1) ?? null,
      unidadesTotales,
      promedioPorCompra: compras.length ? redondear(unidadesTotales / compras.length, 1) : null,
      cadaCuantosDias: compras.length >= 2 ? Math.round(dias(primera, ultima.fecha) / (compras.length - 1)) : null,
      costoUnitario: filas.map((f) => num(f.costo_unitario)).find((x) => x != null) ?? null,
      soloVinculo: false,
    });
  }
  lista.sort((a, b) => (a.ultimaCompra! < b.ultimaCompra! ? 1 : a.ultimaCompra! > b.ultimaCompra! ? -1 : b.compras - a.compras));

  // lo que se sabe que trabaja (lista de precios, recepción con pistola) sin factura leída
  const soloVinculo: ProductoDelProveedor[] = [];
  for (const v of vinculos) {
    if (porProducto.has(v.producto_id)) continue;
    const p = productos.get(v.producto_id);
    if (!p) continue;
    soloVinculo.push({
      sku: p.sku, codigo: codigoDeLaCasa(p), nombre: p.nombre, codigoProveedor: v.codigo_proveedor,
      compras: 0, primeraCompra: null, ultimaCompra: v.actualizado_en ? v.actualizado_en.slice(0, 10) : null,
      ultimoPrecio: null, precioAnterior: null, variacionPct: null, bonificacionPct: null, unidadesPorBulto: null,
      unidadesTotales: 0, promedioPorCompra: null, cadaCuantosDias: null,
      costoUnitario: num(v.ultimo_costo), soloVinculo: true,
    });
  }
  soloVinculo.sort((a, b) => ((a.ultimaCompra ?? '') < (b.ultimaCompra ?? '') ? 1 : -1));

  // renglones que no se vincularon: por código del proveedor o por la descripción
  const sueltos = new Map<string, RenglonHistorial[]>();
  for (const r of merc) {
    if (r.producto_id) continue;
    const clave = r.codigo_proveedor?.trim() || r.descripcion.trim().toLowerCase().replace(/\s+/g, ' ');
    (sueltos.get(clave) ?? sueltos.set(clave, []).get(clave)!).push(r);
  }
  const sinVincular: LineaSinVincular[] = [...sueltos.values()].map((filas) => {
    filas.sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
    return {
      descripcion: filas[0].descripcion,
      codigoProveedor: filas[0].codigo_proveedor,
      compras: new Set(filas.map(claveCompra)).size,
      ultimaCompra: filas[0].fecha,
      ultimoPrecio: precioNeto(filas[0]),
      bonificacionPct: num(filas[0].bonificacion_pct),
      unidadesTotales: redondear(filas.reduce((s, f) => s + (num(f.unidades) ?? 0), 0), 3),
    };
  }).sort((a, b) => (a.ultimaCompra < b.ultimaCompra ? 1 : -1));

  return {
    comprobantes,
    primeraCompra: fechas[0] ?? null,
    ultimaCompra: fechas[fechas.length - 1] ?? null,
    netoComprado: redondear(merc.reduce((s, r) => s + (num(r.importe) ?? 0), 0)),
    productos: [...lista, ...soloVinculo],
    sinVincular,
  };
}
