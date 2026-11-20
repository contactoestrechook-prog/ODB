// CORREGIR UNA FACTURA YA REGISTRADA DESDE LA CARGA (Leandro, 20/11/2026:
// «tenemos que poder modificar una factura ya hecha y que nos damos cuenta que
// tiene un error»). Juan Pablo registró Umami 0006-00070233 el 19/11 a las 19:41
// con «LP Exploración Malbec Chacayes» en cajas de 6 (18 botellas) y a las 19:43
// volvió a la pantalla de carga a ponerle cajas de 4: la factura ya existía y no
// se podía registrar dos veces. Ahora la misma pantalla la corrige: se compara
// lo que dice la carga con lo que entró y solo cambia lo distinto, con la
// corrección de renglones de siempre (stock, costo y precio de venta juntos).

export type RenglonRegistrado = { productoId: string; nombre: string; cantidad: number; costo: number };
export type RenglonDeLaCarga = { productoId: string; nombre: string; cantidad: number; costo: number; margenPct?: number | null };
export type CambioDeRenglon = {
  productoId: string | null;
  productoNuevoId?: string | null;
  cantidad: number;
  costo: number;
  margenPct?: number | null;
  nombre: string;
  antes: { cantidad: number; costo: number } | null;
  detalle: string;
};

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const r3 = (n: number) => Math.round((Number(n) || 0) * 1000) / 1000;
const cant = (n: number) => Number(n).toLocaleString('es-AR', { maximumFractionDigits: 3 });
const pesos = (n: number) => `$${Number(n).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Lo que cambia entre lo que entró y lo que dice la carga corregida, producto
 * por producto: cantidad o costo distinto, lo que se agrega y lo que se saca.
 * El costo se compara al centavo (así se guarda).
 */
export function diferenciasConLoRegistrado(registrados: RenglonRegistrado[], carga: RenglonDeLaCarga[]): CambioDeRenglon[] {
  const antes = new Map(registrados.map((r) => [r.productoId, r]));
  const ahora = new Map<string, RenglonDeLaCarga>();
  for (const c of carga) {
    const ya = ahora.get(c.productoId);
    // el mismo producto en dos renglones: se suma y el costo queda promediado (como al registrar)
    if (ya) {
      const total = ya.cantidad + c.cantidad;
      ahora.set(c.productoId, { ...ya, cantidad: total, costo: total > 0 ? (ya.cantidad * ya.costo + c.cantidad * c.costo) / total : ya.costo });
    } else ahora.set(c.productoId, { ...c });
  }
  const salida: CambioDeRenglon[] = [];
  for (const [id, c] of ahora) {
    const r = antes.get(id);
    const cantidad = r3(c.cantidad);
    const costo = r2(c.costo);
    if (!r) {
      salida.push({ productoId: null, productoNuevoId: id, cantidad, costo, margenPct: c.margenPct ?? null, nombre: c.nombre, antes: null, detalle: `Agregar ${c.nombre}: ${cant(cantidad)} a ${pesos(costo)}` });
      continue;
    }
    const cambiaCantidad = r3(r.cantidad) !== cantidad;
    const cambiaCosto = r2(r.costo) !== costo;
    if (!cambiaCantidad && !cambiaCosto) continue;
    const partes = [
      cambiaCantidad ? `${cant(r.cantidad)} → ${cant(cantidad)}` : '',
      cambiaCosto ? `${pesos(r.costo)} → ${pesos(costo)}` : '',
    ].filter(Boolean).join(' · ');
    salida.push({ productoId: id, cantidad, costo, margenPct: c.margenPct ?? null, nombre: r.nombre, antes: { cantidad: r.cantidad, costo: r.costo }, detalle: `${r.nombre}: ${partes}` });
  }
  for (const [id, r] of antes) {
    if (ahora.has(id) || !(r.cantidad > 0)) continue;
    salida.push({ productoId: id, cantidad: 0, costo: r.costo, nombre: r.nombre, antes: { cantidad: r.cantidad, costo: r.costo }, detalle: `Sacar ${r.nombre} (${cant(r.cantidad)})` });
  }
  return salida.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}

export type EncabezadoFactura = {
  monto?: number | null; neto?: number | null; iva?: number | null; percepcion_iva?: number | null; percepcion_iibb?: number | null;
  impuestos_internos?: number | null; otros_impuestos?: number | null; letra?: string | null; fecha_emision?: string | null; condicion_venta?: string | null;
};
export type EncabezadoDeLaCarga = {
  total?: number; neto?: number; iva?: number; percepcionIva?: number; percepcionIibb?: number; impuestosInternos?: number; otros?: number;
  letra?: string; fechaEmision?: string; condicionVenta?: string;
};

const ETIQUETAS: Record<string, string> = {
  monto: 'Total', neto: 'Neto', iva: 'IVA', percepcionIva: 'Percepción IVA', percepcionIibb: 'Percepción IIBB',
  impuestosInternos: 'Impuestos internos', otros: 'Otros impuestos', letra: 'Letra', fechaEmision: 'Fecha', condicionVenta: 'Condición de venta',
};

/** Lo del pie y el encabezado que cambia (en las claves de editarFactura). */
export function diferenciasDeEncabezado(f: EncabezadoFactura, c: EncabezadoDeLaCarga | null | undefined): { cambios: Record<string, unknown>; detalle: string[] } {
  const cambios: Record<string, unknown> = {};
  const detalle: string[] = [];
  if (!c) return { cambios, detalle };
  const plata: [keyof EncabezadoDeLaCarga, keyof EncabezadoFactura, string][] = [
    ['total', 'monto', 'monto'], ['neto', 'neto', 'neto'], ['iva', 'iva', 'iva'], ['percepcionIva', 'percepcion_iva', 'percepcionIva'],
    ['percepcionIibb', 'percepcion_iibb', 'percepcionIibb'], ['impuestosInternos', 'impuestos_internos', 'impuestosInternos'], ['otros', 'otros_impuestos', 'otros'],
  ];
  for (const [deCarga, deBase, clave] of plata) {
    const v = c[deCarga];
    if (v == null || !Number.isFinite(Number(v))) continue;
    if (clave === 'monto' && !(Number(v) > 0)) continue;
    if (r2(Number(v)) === r2(Number(f[deBase] ?? 0))) continue;
    cambios[clave] = r2(Number(v));
    detalle.push(`${ETIQUETAS[clave]}: ${pesos(Number(f[deBase] ?? 0))} → ${pesos(Number(v))}`);
  }
  const texto: [keyof EncabezadoDeLaCarga, keyof EncabezadoFactura, string][] = [
    ['letra', 'letra', 'letra'], ['fechaEmision', 'fecha_emision', 'fechaEmision'], ['condicionVenta', 'condicion_venta', 'condicionVenta'],
  ];
  for (const [deCarga, deBase, clave] of texto) {
    const v = String(c[deCarga] ?? '').trim();
    if (!v || v === String(f[deBase] ?? '').trim()) continue;
    cambios[clave] = v;
    detalle.push(`${ETIQUETAS[clave]}: ${String(f[deBase] ?? '—')} → ${v}`);
  }
  return { cambios, detalle };
}
