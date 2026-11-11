// ============================================================
// LA FICHA DEL ARTÍCULO DEL PROVEEDOR (11/11/2026). Leandro: «memoria para
// cada proveedor … para que no falle más».
//
// Qué se recuerda: cómo viene y cómo entra cada artículo de cada proveedor, tal
// como lo confirmó una persona la última vez que registró una factura con él.
// No es una regla escrita: es lo que quedó registrado.
//
//   Rhodesia (Rueda Que Rueda): 1 caja de 36 → entran 12 paquetes de 3.
//   Danbo en horma (La Serenísima): 6 hormas → entran 21 kilos (3,5 por horma).
//   Halls 12 × 28 g: la cantidad son paquetes → entran abiertos, 12 por paquete.
//
// El dato central es el FACTOR: cuánto entra al stock por cada 1 de la columna
// Cantidad del papel. Con él, la factura siguiente se controla sola: si lo que
// queda cargado no es cantidad × factor, la ficha no se aplicó bien y no se usa.
//
// Funciones puras. La parte que arma los cambios sobre la tabla vive en el
// panel (apps/admin/app/lib/ficha-articulo.ts), como el resto de la tabla.
// ============================================================

export type EntraFicha = 'unidades' | 'cajas' | 'abiertas' | 'peso';

/** La presentación de un artículo: lo que no cambia de una factura a la otra. */
export type Presentacion = {
  cuentaEn: 'bultos' | 'sueltas';
  unidadesPorBulto: number | null;
  entraComo: EntraFicha;
  entraDe: number | null;
  factor: number | null;
  /** cuánto entra al stock por cada unidad del papel (bultos × lo que trae cada uno, o las sueltas) */
  porUnidad: number | null;
  /** lo que costó cada unidad de stock la última vez, neto (importe del renglón ÷ lo que entró) */
  costoNeto: number | null;
};

export type FichaArticulo = Presentacion & {
  clave: string;
  descripcion: string;
  codigoProveedor: string | null;
  productoId: string | null;
  veces: number;
  ultimaFactura: string | null;
  ultimaFecha: string | null;
};

/** Un renglón tal como quedó registrado (lo que manda la pantalla, o compras_historial). */
export type RenglonRegistrado = {
  descripcion?: string | null;
  bultos?: number | null;
  unidadesPorBulto?: number | null;
  sueltas?: number | null;
  entraComo?: string | null;
  /** lo que entró al stock; si llegó una parte, es menos que lo facturado */
  cantidadStock?: number | null;
  /** lo facturado en unidades de stock, sin restar lo que faltó (la pantalla lo manda desde el 11/11) */
  cantidadEntera?: number | null;
  /** el importe del renglón (neto, con su descuento) */
  importe?: number | null;
  incluido?: boolean | null;
  esDescuento?: boolean | null;
};

const n = (v: unknown): number | null => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const redondear = (x: number, d = 4) => Math.round(x * 10 ** d) / 10 ** d;
const cerca = (a: number, b: number, tol = 0.005) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
/** un entero ≥ 2 (con el margen de un redondeo), o null */
const enteroDesde2 = (x: number): number | null => {
  const r = Math.round(x);
  return r >= 2 && cerca(x, r) ? r : null;
};

/**
 * La clave del artículo: su descripción en el papel, sin acentos, signos ni
 * mayúsculas/minúsculas. El código del proveedor no sirve de clave: se lee de
 * una foto y trae errores de dígito (6 en 52, medido el 7/10/2026).
 */
export function claveArticulo(descripcion: unknown): string {
  return String(descripcion ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
    .slice(0, 160);
}

/**
 * La presentación que deja un renglón registrado. null si de ese renglón no se
 * puede aprender: un descuento, una devolución, algo que no entró al stock,
 * bultos y sueltas mezclados, o una cuenta que no da redonda (llegó una parte).
 */
export function presentacionDeRenglon(r: RenglonRegistrado): Presentacion | null {
  if (!r || r.esDescuento || r.incluido === false) return null;
  const como = String(r.entraComo ?? '');
  if (como !== 'unidades' && como !== 'cajas' && como !== 'abiertas' && como !== 'peso') return null;
  const b = n(r.bultos) ?? 0;
  const s = n(r.sueltas) ?? 0;
  const uxb = (n(r.unidadesPorBulto) ?? 0) > 1 ? (n(r.unidadesPorBulto) as number) : null;
  const total = n(r.cantidadEntera) ?? n(r.cantidadStock);

  // por peso y sin papel: el lector ya trae los kilos del papel, no hay nada que aplicar
  if (como === 'peso' && r.bultos == null && r.sueltas == null) {
    return { cuentaEn: 'sueltas', unidadesPorBulto: null, entraComo: 'peso', entraDe: null, factor: null, porUnidad: null, costoNeto: null };
  }
  // la columna Cantidad cuenta UNA cosa: bultos o sueltas
  if (b > 0 === s > 0) return null;
  const q = b > 0 ? b : s;
  const cuentaEn = b > 0 ? 'bultos' as const : 'sueltas' as const;
  // las unidades que dice el papel (bultos × lo que trae cada uno, o las sueltas)
  const delPapel = cuentaEn === 'bultos' ? q * (uxb ?? 1) : q;

  // El costo neto de cada unidad de stock: sirve para elegir, la próxima vez,
  // entre dos lecturas del mismo papel («1 caja a precio de caja» o «36 a
  // precio de unidad»): la buena es la que deja el costo parecido a este.
  const importe = Math.abs(n(r.importe) ?? 0);
  const costo = (entraron: number) => (importe > 0 && entraron > 0 ? redondear(importe / entraron) : null);
  if (como === 'unidades') {
    // tal cual: aunque haya llegado una parte, la presentación es la misma
    return { cuentaEn, unidadesPorBulto: uxb, entraComo: 'unidades', entraDe: null, factor: redondear(delPapel / q), porUnidad: 1, costoNeto: costo(delPapel) };
  }
  if (total == null || !(total > 0)) return null;
  if (como === 'peso') {
    return { cuentaEn, unidadesPorBulto: uxb, entraComo: 'peso', entraDe: null, factor: redondear(total / q), porUnidad: redondear(total / delPapel), costoNeto: costo(total) };
  }
  // Si no se sabe cuánto se facturó entero (lo registrado antes del 11/11 solo
  // tiene lo que entró), una entrega parcial puede dar un número redondo por
  // casualidad: 30 facturadas y 2,3 cajas recibidas «dan» cajas de 13. Ahí la
  // caja tiene que salir del papel: la que dice el bulto, o una parte exacta.
  const facturadoEntero = n(r.cantidadEntera) != null;
  if (como === 'cajas') {
    const de = enteroDesde2(delPapel / total);
    const creible = de != null && (facturadoEntero || (uxb != null && (de === uxb || uxb % de === 0)));
    return creible ? { cuentaEn, unidadesPorBulto: uxb, entraComo: 'cajas', entraDe: de, factor: redondear(delPapel / q / de), porUnidad: redondear(1 / (de as number), 6), costoNeto: costo(delPapel / (de as number)) } : null;
  }
  const de = enteroDesde2(total / delPapel);
  const creible = de != null && (facturadoEntero || (uxb != null && de === uxb));
  return creible ? { cuentaEn, unidadesPorBulto: uxb, entraComo: 'abiertas', entraDe: de, factor: redondear((delPapel / q) * (de as number)), porUnidad: de, costoNeto: costo(delPapel * (de as number)) } : null;
}

export function mismaPresentacion(a: Presentacion | null | undefined, b: Presentacion | null | undefined): boolean {
  if (!a || !b) return false;
  return a.cuentaEn === b.cuentaEn
    && (a.unidadesPorBulto ?? null) === (b.unidadesPorBulto ?? null)
    && a.entraComo === b.entraComo
    && (a.entraDe ?? null) === (b.entraDe ?? null)
    && (a.factor == null ? b.factor == null : b.factor != null && cerca(a.factor, b.factor, 0.01));
}

/**
 * La ficha que queda después de un registro nuevo: manda lo último que se
 * confirmó. «veces» cuenta los registros seguidos que coinciden; si cambió la
 * presentación, vuelve a 1.
 */
export function fichaTrasRegistro(
  previa: Pick<FichaArticulo, 'veces'> & Presentacion | null | undefined,
  nueva: Presentacion,
): { presentacion: Presentacion; veces: number } {
  return { presentacion: nueva, veces: previa && mismaPresentacion(previa, nueva) ? Math.max(1, previa.veces) + 1 : 1 };
}
