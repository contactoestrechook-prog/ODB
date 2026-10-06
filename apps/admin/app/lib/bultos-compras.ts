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
//   · Multiplicar ×N: son cajas y el producto es la unidad. Se llamaba "Pasar
//     a unidades" y es el rótulo que Ana entendió al revés ("si yo pongo pasar
//     a unidades me toma 28 cajas"); al lado de "Ya vienen en unidades" eran
//     dos botones con "unidades" que hacían cosas opuestas (6/10/2026).
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
  /** lo había resuelto el lector y una persona dijo que no ("cambiar") */
  rechazada?: boolean;
};

/** De dónde salió el «×N» (apps/api/src/compras/bultos.ts → OrigenBulto). */
export type OrigenBulto = 'palabra' | 'texto' | 'modelo' | null;

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
  // Con las cajas armadas ("28 u. = 2 cajas de 14") el renglón ya no entra
  // "como dice el papel": manda lo armado, y al deshacerlo vuelve (6/10/2026).
  if (num(i.bultoDescartado) > 1 && !(num(i.envaseAplicado) > 1)) return i.bultoDescartadoComo === 'caja' ? 'caja' : 'ya_en_unidades';
  return null;
}

/** Lo que factura el renglón entero, neto: el importe, o el unitario menos la bonificación. */
function totalDelRenglon(i: Renglon): number {
  const importe = i.importe == null || i.importe === '' ? null : Math.abs(num(i.importe));
  if (importe != null) return importe;
  const bonif = Math.min(100, Math.abs(num(i.bonificacionPct)));
  return num(i.cantidad) * num(i.precio) * (1 - bonif / 100);
}

/**
 * ¿El precio del papel ya es el de cada unidad de adentro? Pasa cuando la
 * cantidad son cajas y el precio es por unidad: "Tostadas Tosti 12x200"
 * 1 × $828,10 = $9.639,07 (12 × 828,10 con 3% off). Ahí multiplicar la
 * cantidad no tiene que dividir el precio: quedaba "12 × $69 = $9.639" y la
 * nota decía "se paga $803 de los $69 de lista" (6/10/2026).
 */
function precioYaEsDeLaUnidad(i: Renglon, n: number): boolean {
  const importe = i.importe == null || i.importe === '' ? 0 : Math.abs(num(i.importe));
  const precio = num(i.precio);
  if (!(importe > 0) || !(precio > 0)) return false;
  const bonif = Math.min(100, Math.abs(num(i.bonificacionPct)));
  const contandoLasDeAdentro = num(i.cantidad) * n * precio * (1 - bonif / 100);
  return Math.abs(contandoLasDeAdentro - importe) <= Math.max(0.05, importe * 0.02);
}

/** Son cajas y el producto es la unidad: la cantidad × N, el precio ÷ N (si era el de la caja). */
export function pasarAUnidades<T extends Renglon>(i: T): T {
  const n = Math.round(num(i.unidadesPorBulto));
  if (!(n > 1)) return i;
  return {
    ...i,
    cantidad: num(i.cantidad) * n,
    precio: precioYaEsDeLaUnidad(i, n) ? num(i.precio) : redondear(num(i.precio) / n),
    // se guarda para poder volver atrás tal cual (sin el redondeo de ÷ N × N)
    // y para dejar dicho qué se hizo
    precioAntesDelBulto: i.precio,
    bultoAplicado: n,
    unidadesPorBulto: null,
  };
}

/** Deshace "Multiplicar ×N" (o el bulto cargado a mano). */
export function volverABulto<T extends Renglon>(i: T): T {
  const n = Math.round(num(i.bultoAplicado));
  if (!(n > 1)) return i;
  const antes = i.precioAntesDelBulto;
  return {
    ...i,
    cantidad: num(i.cantidad) / n,
    precio: antes != null && antes !== '' ? antes : redondear(num(i.precio) * n),
    precioAntesDelBulto: null,
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

/**
 * Deshace "ya vienen en unidades" / "dejar en cajas": el renglón vuelve a
 * preguntar. Si lo había resuelto el lector, la persona le está diciendo que
 * no: la tarjeta ya no le vuelve a sugerir en negrita lo que acaba de negar.
 * El porqué del lector queda a la vista, como dato (6/10/2026).
 */
export function volverAPendiente<T extends Renglon>(i: T): T {
  const n = Math.round(num(i.bultoDescartado));
  if (!(n > 1)) return i;
  const r = i.razonBulto as RazonBulto | null | undefined;
  const razonBulto = i.bultoAuto && r ? { ...r, sugerencia: null, rechazada: true } : r ?? null;
  return { ...i, unidadesPorBulto: n, bultoDescartado: null, bultoDescartadoComo: null, bultoAuto: false, razonBulto };
}

/**
 * Se cambió el producto vinculado. Si lo que decidió (o sugirió) el lector se
 * apoyaba en el producto anterior —su costo o su presentación—, deja de valer:
 * lo decidido solo vuelve a preguntar y la sugerencia se borra. Lo que eligió
 * una persona se respeta.
 *
 * Lo que probó el papel (la columna "2 bultos, 0 unidades") tampoco depende
 * del producto: los 28 siguen siendo unidades sueltas. Si el producto nuevo es
 * la caja de 14, volver a preguntar "¿cajas o unidades?" no lleva a ninguna
 * salida correcta (las tres dejan 28 cajas o 392); lo correcto es armar 2
 * cajas, y eso lo ofrece la pantalla en el renglón que quedó "ya en unidades"
 * (conversionSugerida con cantidadEnUnidades, 6/10/2026).
 */
export function alCambiarVinculo<T extends Renglon>(i: T): T {
  const r = i.razonBulto as RazonBulto | null | undefined;
  if (!r || (r.evidencia !== 'costo' && r.evidencia !== 'catalogo')) return i;
  if (i.bultoAuto && num(i.bultoDescartado) > 1) return { ...volverAPendiente(i), razonBulto: null };
  return { ...i, razonBulto: null };
}

/**
 * Lo que muestra el renglón pendiente: la pregunta, las dos cuentas y cuál
 * sugiere la evidencia.
 *
 * Las cuentas salen de lo que factura el renglón (el importe), no del precio
 * del papel: es lo que de verdad va a entrar. Con las tostadas de a 12
 * (1 × $828,10 = $9.639,07) decía "Pasar a unidades — 12 a $69" y "Ya vienen
 * en unidades — 1 a $828"; en realidad son 12 a $803 o 1 a $9.639. La que
 * tenía el número absurdo era justo la sugerida (6/10/2026).
 */
export function opcionesDelBulto(i: Renglon) {
  const n = Math.round(num(i.unidadesPorBulto));
  if (!(n > 1)) return null;
  const cantidad = num(i.cantidad);
  const total = totalDelRenglon(i);
  const r = i.razonBulto as RazonBulto | null | undefined;
  const delTexto = i.bultoOrigen === 'palabra' || i.bultoOrigen === 'texto';
  return {
    n,
    talCual: { cantidad, precio: cantidad > 0 ? redondear(total / cantidad) : num(i.precio) },
    convertido: { cantidad: cantidad * n, precio: cantidad > 0 ? redondear(total / (cantidad * n)) : redondear(num(i.precio) / n) },
    sugerida: r?.sugerencia ?? null,
    motivo: r?.motivo ?? null,
    rechazada: !!r?.rechazada,
    // "La descripción dice ×12" solo si la descripción lo dice: un 12 que el
    // lector sacó de otra columna ("U×B 12") no está en la descripción
    dice: delTexto ? 'La descripción dice' : 'El papel dice',
    pregunta: cantidad === 1
      ? '¿El 1 del papel es una caja o una unidad?'
      : `¿Los ${cantidad.toLocaleString('es-AR')} del papel son cajas o unidades?`,
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
 * ¿"Multiplicar ×N" deja el costo por el piso? Si después de dividir queda
 * por debajo del 25% del costo del catálogo, y antes estaba más cerca, lo más
 * probable es que ya fueran unidades: se pide confirmación (no se bloquea).
 */
export function conversionBajaDeMas(costoFinalActual: number, n: number, costoCatalogo: unknown): boolean {
  const cat = Number(costoCatalogo);
  if (!(cat > 0) || !(n > 1) || !(costoFinalActual > 0)) return false;
  const despues = costoFinalActual / n;
  return despues < cat * 0.25 && Math.abs(Math.log(costoFinalActual / cat)) < Math.abs(Math.log(despues / cat));
}
