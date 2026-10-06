// ============================================================
// RENGLONES QUE DICEN «×N»: ¿CAJAS O YA UNIDADES? (6/10/2026)
//
// Queja de Ana (administración): "en la fc dice 2 bultos en unidades marca 0 y
// la app no lo toma" · "si yo pongo pasar a unidades me toma 28 cajas no 28
// unidades". Factura de MARINA MAPACA: "DORITOS QUESO 200GX14" 28 × $4.899,65.
// Eran 28 UNIDADES (2 bultos de 14). La pantalla daba por hecho que eran 28
// cajas, el único botón multiplicaba (392 a $350) y no había forma de decir
// "ya vienen en unidades". La factura no se registró.
//
// Un renglón con «×N» tiene tres salidas, y las tres tienen que estar a mano:
//   · Ya vienen en unidades: se saca la marca; cantidad, precio e importe
//     quedan como en el papel.
//   · Pasar a unidades: son cajas y el producto es la unidad (× N).
//   · Dejar en cajas: el producto del catálogo es la caja; no se toca nada.
//
// El lector (apps/api/src/compras/bultos.ts → evaluarBulto) ya decide solo el
// "no multiplicar" cuando la evidencia es firme, y deja la sugerencia y la
// cuenta cuando no. Acá no se vuelve a decidir nada de eso —una regla escrita
// dos veces es la que se desalinea—: solo se aplican las salidas, se cuenta lo
// pendiente y se calcula la variación del costo con la salida elegida.
//
// Funciones puras, sin React: las prueban los tests de la API
// (apps/api/src/compras/bultos-compras.spec.ts).
// ============================================================

export type RazonBulto = {
  sugerencia: 'unidades' | 'caja' | 'convertir' | null;
  evidencia: 'columna' | 'catalogo' | 'costo' | 'importe' | null;
  motivo: string;
};

type Renglon = Record<string, unknown>;

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const redondear = (n: number) => Math.round(n * 100) / 100;

export type EstadoBulto = 'pendiente' | 'convertido' | 'ya_en_unidades' | 'caja' | null;

/** En qué quedó el «×N» del renglón. Solo 'pendiente' falta resolver. */
export function estadoDelBulto(i: Renglon): EstadoBulto {
  if (num(i.unidadesPorBulto) > 1) return 'pendiente';
  if (num(i.bultoAplicado) > 1) return 'convertido';
  if (num(i.bultoDescartado) > 1) return i.bultoDescartadoComo === 'caja' ? 'caja' : 'ya_en_unidades';
  return null;
}

/** Son cajas y el producto es la unidad: la cantidad × N, el precio ÷ N. */
export function pasarAUnidades<T extends Renglon>(i: T): T {
  const n = Math.round(num(i.unidadesPorBulto));
  if (!(n > 1)) return i;
  return {
    ...i,
    cantidad: num(i.cantidad) * n,
    precio: redondear(num(i.precio) / n),
    // se guarda para poder volver atrás y para dejar dicho qué se hizo
    bultoAplicado: n,
    unidadesPorBulto: null,
  };
}

/** Deshace "Pasar a unidades" (o el bulto cargado a mano). */
export function volverABulto<T extends Renglon>(i: T): T {
  const n = Math.round(num(i.bultoAplicado));
  if (!(n > 1)) return i;
  return {
    ...i,
    cantidad: num(i.cantidad) / n,
    precio: redondear(num(i.precio) * n),
    bultoAplicado: null,
    unidadesPorBulto: i.bultoManual ? null : n,
    bultoManual: false,
  };
}

function descartar<T extends Renglon>(i: T, como: 'unidades' | 'caja'): T {
  const n = Math.round(num(i.unidadesPorBulto));
  if (!(n > 1)) return i;
  // cantidad, precio e importe NO se tocan: entran como dice el papel
  return { ...i, unidadesPorBulto: null, bultoDescartado: n, bultoDescartadoComo: como, bultoAuto: false };
}

/** La cantidad del papel ya está en unidades: se saca la marca y no se multiplica. */
export const yaEnUnidades = <T extends Renglon>(i: T): T => descartar(i, 'unidades');

/** El producto del catálogo es la caja: entra como caja, sin multiplicar. */
export const dejarEnCajas = <T extends Renglon>(i: T): T => descartar(i, 'caja');

/** Deshace "ya vienen en unidades" / "dejar en cajas": el renglón vuelve a preguntar. */
export function volverAPendiente<T extends Renglon>(i: T): T {
  const n = Math.round(num(i.bultoDescartado));
  if (!(n > 1)) return i;
  return { ...i, unidadesPorBulto: n, bultoDescartado: null, bultoDescartadoComo: null, bultoAuto: false };
}

/**
 * Se cambió el producto vinculado. Si lo que decidió (o sugirió) el lector se
 * apoyaba en el producto anterior —su costo o su presentación—, deja de valer:
 * lo decidido solo vuelve a preguntar y la sugerencia se borra. Lo que eligió
 * una persona se respeta.
 */
export function alCambiarVinculo<T extends Renglon>(i: T): T {
  const r = i.razonBulto as RazonBulto | null | undefined;
  if (!r || (r.evidencia !== 'costo' && r.evidencia !== 'catalogo')) return i;
  if (i.bultoAuto && num(i.bultoDescartado) > 1) return { ...volverAPendiente(i), razonBulto: null };
  return { ...i, razonBulto: null };
}

/** Lo que muestra el renglón pendiente: las dos cuentas y cuál sugiere la evidencia. */
export function opcionesDelBulto(i: Renglon) {
  const n = Math.round(num(i.unidadesPorBulto));
  if (!(n > 1)) return null;
  const cantidad = num(i.cantidad);
  const precio = num(i.precio);
  const r = i.razonBulto as RazonBulto | null | undefined;
  return {
    n,
    talCual: { cantidad, precio },
    convertido: { cantidad: cantidad * n, precio: redondear(precio / n) },
    sugerida: r?.sugerencia ?? null,
    motivo: r?.motivo ?? null,
  };
}

/**
 * Variación del costo que va a quedar en stock contra el costo del catálogo,
 * con la salida elegida. Las dos puntas son costo final (con IVA y
 * percepciones): antes se comparaba el precio NETO del papel, dividido por el
 * «×N» del lector, contra el costo final, y salía "−93,9%" en un renglón que
 * subía un 10%.
 */
export function variacionDeCosto(costoFinal: number, costoCatalogo: unknown): number | null {
  const cat = Number(costoCatalogo);
  if (!(cat > 0) || !(costoFinal > 0) || !Number.isFinite(costoFinal)) return null;
  return Math.round((costoFinal / cat - 1) * 1000) / 10;
}

/**
 * ¿"Pasar a unidades" deja el costo por el piso? Si después de dividir queda
 * por debajo del 25% del costo del catálogo, y antes estaba más cerca, lo más
 * probable es que ya fueran unidades: se pide confirmación (no se bloquea).
 */
export function conversionBajaDeMas(costoFinalActual: number, n: number, costoCatalogo: unknown): boolean {
  const cat = Number(costoCatalogo);
  if (!(cat > 0) || !(n > 1) || !(costoFinalActual > 0)) return false;
  const despues = costoFinalActual / n;
  return despues < cat * 0.25 && Math.abs(Math.log(costoFinalActual / cat)) < Math.abs(Math.log(despues / cat));
}
