// Cuántas unidades trae un bulto, leído del texto del renglón — LÓGICA PURA.
//
// Por qué en código y no solo en el prompt de la IA: cada proveedor escribe la
// caja a su manera ("CJ x 6", "x24B", "6x750", "PACK X 12", "CJx6") y una lista
// de casos en el prompt se rompe con el próximo proveedor que aparezca. Acá se
// describe la FORMA, no los ejemplos: un número chico pegado a una palabra de
// bulto, o un número chico multiplicando un tamaño de envase.
//
// Equivocarse acá se paga dos veces: entra mal el stock (7 cajas en vez de 42
// botellas) y entra mal el costo unitario, que es de donde sale el precio de
// venta.

/** Un bulto real de bebidas va de 2 a 60 unidades. Fuera de eso es otra cosa. */
const MIN_BULTO = 2;
const MAX_BULTO = 60;

/** Tamaños de envase: si el número grande es uno de estos, el chico es el pack. */
const ES_TAMANO = (n: number) => n >= 100;

const normalizar = (t: string) =>
  String(t ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const plausible = (n: number) => Number.isFinite(n) && n >= MIN_BULTO && n <= MAX_BULTO;

/**
 * Devuelve las unidades por bulto que declara la descripción, o null si no lo
 * dice. NUNCA adivina: ante la duda devuelve null, porque multiplicar de más
 * es tan caro como no multiplicar.
 */
export function unidadesPorBulto(descripcion: string): number | null {
  const t = normalizar(descripcion);
  if (!t) return null;

  // 1) Palabra de bulto + número: "CJ x 6", "caja x12", "pack 6", "display 24".
  //    Es la forma más explícita, así que va primero.
  //    Sin borde de palabra al final: "CJx6" viene todo pegado. Las variantes
  //    largas van primero para que "cajon" no matchee como "caja".
  const porPalabra = t.match(
    /\b(?:cajon(?:es)?|cajas?|cja|cj|packs?|box|bultos?|display|bandejas?|bdj|estuche)\s*x?\s*(\d{1,3})\b/,
  );
  if (porPalabra && plausible(Number(porPalabra[1]))) return Number(porPalabra[1]);

  // 2) Número + x + número de envase: "6x750", "12 x 1000cc".
  //    El chico es el pack y el grande el tamaño. El orden importa: en
  //    "355 X 24B" el primero es el tamaño, así que esta regla NO tiene que
  //    dispararse (la agarra la 3).
  const porEnvase = t.match(/\b(\d{1,2})\s*x\s*(\d{3,4})\s*(?:cc|ml|cm3|l|lt|lts|litros?)?\b/);
  if (porEnvase && plausible(Number(porEnvase[1])) && ES_TAMANO(Number(porEnvase[2]))) {
    return Number(porEnvase[1]);
  }

  // 3) "x" + número, sin más. Es la forma más común y la que no se puede
  //    enumerar: cada bodega mete su abreviatura antes ("cc x 6", "SV x 6",
  //    "CJ x6", "x 24B"). En vez de listar las abreviaturas —que es lo que se
  //    rompe con el proveedor nuevo— se acepta cualquier cosa antes de la "x",
  //    y se filtra por lo que sigue: si el número es un tamaño de envase
  //    ("x 750", "x 1000cc") no es un bulto, y si no entra en 2..60 tampoco.
  for (const m of t.matchAll(/\bx\s*(\d{1,4})\s*([a-z]*)/g)) {
    const n = Number(m[1]);
    const sufijo = m[2] ?? '';
    if (!plausible(n)) continue; // 750, 1000, 2019… no son bultos
    // Una unidad de medida después del número descarta el bulto SOLO si ese
    // número podría ser esa medida de verdad. "x 2 L" es un envase de dos
    // litros; "SV x 6 cc" no es un envase de seis centímetros cúbicos —
    // ninguna bebida se vende así— es una caja de seis con la abreviatura de
    // la bodega al lado.
    if (/^(cc|ml|cm3)$/.test(sufijo) && n >= 50) continue;
    if (/^(l|lt|lts|litros?)$/.test(sufijo) && n <= 10) continue;
    if (/^(g|gr|gramos?)$/.test(sufijo) && n >= 50) continue;
    if (/^(kg|k|kilos?)$/.test(sufijo) && n <= 25) continue;
    return n;
  }

  return null;
}

/**
 * ¿El renglón es una REBAJA sobre otro renglón y no mercadería?
 *
 * La regla general —y la única que no depende de cómo escriba cada proveedor—
 * es el signo: un importe negativo nunca es mercadería que entra. El texto se
 * usa solo como refuerzo para los casos raros en que el papel imprime el
 * descuento en positivo.
 */
export function esRenglonDeDescuento(renglon: { descripcion?: string; precio?: number }): boolean {
  if (Number(renglon?.precio) < 0) return true;
  const t = normalizar(renglon?.descripcion ?? '');
  return /^(desc|dto|descuento|bonif|bonificacion|rebaja|nota de credito)\b/.test(t);
}

export type RenglonEntrada = { sku: string; cantidad: number; costo: number; [k: string]: any };

/**
 * Junta los renglones repetidos del mismo producto y reparte lo que no se pagó
 * entre todo lo que llegó.
 *
 * Es el arreglo comercial de siempre: "comprás 20 cajas, te regalo 3". Las 3
 * que no se pagan bajan el costo de las 23, no entran como un producto de
 * costo cero al lado del de costo lleno. La cuenta es plata pagada dividida
 * unidades recibidas.
 *
 * Hace falta acá, en el servidor, y no solo en la pantalla: la entrada fija el
 * costo del producto por SKU, así que dos renglones del mismo producto lo
 * escribían dos veces y ganaba el último. Cuando el último es el regalado, el
 * producto quedaba con costo CERO y el precio de venta se calculaba sobre cero.
 */
export function fusionarRenglonesPorSku<T extends RenglonEntrada>(items: T[]): T[] {
  const porSku = new Map<string, { base: T; unidades: number; pagado: number }>();
  for (const i of items) {
    const cantidad = Number(i.cantidad) || 0;
    const costo = Number(i.costo) || 0;
    const previo = porSku.get(i.sku);
    if (!previo) porSku.set(i.sku, { base: i, unidades: cantidad, pagado: cantidad * costo });
    else {
      previo.unidades += cantidad;
      previo.pagado += cantidad * costo;
      // el margen puesto a mano en cualquiera de los renglones vale para todos
      if ((previo.base as any).margenPct == null && (i as any).margenPct != null) (previo.base as any).margenPct = (i as any).margenPct;
    }
  }
  return [...porSku.values()].map(({ base, unidades, pagado }) => ({
    ...base,
    cantidad: unidades,
    costo: unidades > 0 ? Math.round((pagado / unidades) * 100) / 100 : 0,
  }));
}

/**
 * El porcentaje que declara un renglón de descuento, si lo dice.
 * "Desc. 42.86% - MANOS NEGRAS Malbec" → 42.86 · "Px mágico $12.000 MP = 17,2%" → 17.2
 */
export function porcentajeDeDescuento(descripcion: string): number | null {
  const t = String(descripcion ?? '').replace(/\s+/g, ' ');
  const m = t.match(/(\d{1,3}(?:[.,]\d{1,2})?)\s*%/);
  if (!m) return null;
  const n = Number(m[1].replace(',', '.'));
  return Number.isFinite(n) && n > 0 && n <= 100 ? n : null;
}

/**
 * ¿Esta rebaja es realmente de ESE renglón?
 *
 * La pregunta importa porque una factura puede traer descuentos de un renglón
 * puntual y promociones que cubren varios renglones o la factura entera, y se
 * imprimen igual. Adjudicarle a un solo producto una rebaja que era de todos
 * le deja el costo por el piso, y de ahí sale el precio de venta.
 *
 * Cuando el papel declara el porcentaje, ese porcentaje es la prueba: si la
 * rebaja fuera de este renglón, tiene que dar ese porcentaje del renglón.
 * "Desc. 42,86%" sobre 305.454 da 130.917 y cierra. "Px mágico = 17,2%" de
 * 52.963 sobre un renglón de 45.055 daría 117%: no es de ese renglón.
 */
export function descuentoEsDelRenglon(
  importeDescuento: number,
  totalDelRenglon: number,
  pctDeclarado: number | null,
): boolean {
  const d = Math.abs(Number(importeDescuento) || 0);
  const linea = Math.abs(Number(totalDelRenglon) || 0);
  if (d === 0) return true;
  if (linea === 0) return false;
  if (pctDeclarado != null) {
    const real = (d / linea) * 100;
    return Math.abs(real - pctDeclarado) <= 1; // un punto de tolerancia por redondeos
  }
  // sin porcentaje declarado, lo único que se puede afirmar es que una rebaja
  // no puede superar a lo que rebaja
  return d <= linea;
}



/**
 * ¿ESTE producto puede venderse por peso?
 *
 * Hace falta porque "la cuenta del renglón no cierra" tiene varias
 * explicaciones —se leyó mal la cantidad, se leyó mal el precio, hay un
 * descuento, o el producto se factura por kilo— y el sistema estaba eligiendo
 * siempre la última. Así una lata de cerveza terminaba entrando como 24 kg.
 *
 * La bebida es el caso claro: una botella o una lata tienen peso, pero NUNCA se
 * venden por kilo. Ese veto va primero y no admite excepción. Después se pide
 * evidencia positiva: una unidad de peso escrita, o un producto de los que se
 * fraccionan. Sin evidencia, la respuesta es NO — cargar kilos donde van
 * unidades multiplica el costo por cualquier cosa, y el error al revés lo
 * corrige una persona con un botón.
 */
const RE_BEBIDA = /\b(\d+\s*)?(ml|cc|cm3|lts?|litros?)\b|\b\d+\s*l\b|\b(cerveza|birra|lata|latas|botella|botellas|vino|tinto|blanco|malbec|cabernet|chardonnay|torrontes|syrah|merlot|espumante|champagne|champ[aá]n|sidra|blend|reserva|varietal|bonarda|chenin|pinot|rosado|tannat|semillon|semill[oó]n|gaseosa|agua|soda|jugo|whisky|whiskey|vodka|gin|ron|fernet|aperitivo|licor|amargo|vermouth|tequila|pack)\b/i;

const RE_POR_PESO = /\b(kgs?|kilos?|kilogramos?|gramos?|grs?)\b|\b(fiambre|jam[oó]n|queso|quesos|salame|salam[ií]n|mortadela|bondiola|panceta|lomito|matambre|milanesa|carne|pollo|pechuga|molida|muzzarella|mozzarella|provolone|roquefort|cheddar|feta|fraccionad[oa]|horma|granel|suelto)\b/i;

export function puedeVendersePorPeso(descripcion: string): boolean {
  const t = String(descripcion ?? '');
  if (!t.trim()) return false;
  if (RE_BEBIDA.test(t)) return false; // veto: la bebida nunca se vende por kilo
  return RE_POR_PESO.test(t);
}

export type CorreccionRenglon = { campo: 'cantidad' | 'precio'; valor: number; seguro: boolean };

/**
 * Un renglón de una factura SIEMPRE cierra: cantidad × precio unitario da el
 * importe impreso. Es un documento fiscal, no una estimación. Si en nuestra
 * lectura no cierra, el que leyó mal es el sistema — y el importe es el número
 * más confiable de los tres, porque es el que suma al neto del pie.
 *
 * Falta saber CUÁL de los otros dos está mal, y el papel lo dice:
 *
 *  · Si importe ÷ precio da un ENTERO exacto, ese entero es la cantidad y el
 *    precio está bien. Nadie compra 24,000 unidades por casualidad: pasa cuando
 *    el lector tomó la cantidad de la fila de al lado. Es evidencia dura, así
 *    que se corrige solo.
 *  · Si no da entero, el sospechoso es el precio, y se propone importe ÷
 *    cantidad — pero sin aplicarlo, porque ahí no hay certeza.
 */
export function corregirRenglonQueNoCierra(renglon: {
  cantidad?: number;
  precio?: number;
  importe?: number | null;
}): CorreccionRenglon | null {
  const cantidad = Number(renglon?.cantidad) || 0;
  const precio = Number(renglon?.precio) || 0;
  const importe = renglon?.importe == null ? null : Math.abs(Number(renglon.importe));
  if (!cantidad || !precio || importe == null || importe === 0) return null;

  const esperado = cantidad * precio;
  if (Math.abs(importe - esperado) / esperado <= 0.02) return null; // cierra

  const cantidadQueDaria = importe / precio;
  const entero = Math.round(cantidadQueDaria);
  const esEnteroLimpio = entero >= 1 && Math.abs(cantidadQueDaria - entero) <= 0.005;
  if (esEnteroLimpio && entero !== cantidad) {
    return { campo: 'cantidad', valor: entero, seguro: true };
  }

  return { campo: 'precio', valor: Math.round((importe / cantidad) * 100) / 100, seguro: false };
}

export type RenglonResuelto = {
  cantidad: number;
  unidadesPorBulto: number | null;
  /** la cantidad que decía el papel, si se corrigió */
  cantidadOriginal: number | null;
  /** el bulto que la corrección dejó consumido, para poder deshacer */
  bultoConsumido: number | null;
};

/**
 * Resuelve cantidad y bulto de un renglón, juntos, porque son la MISMA cuenta.
 *
 * El formato más común de factura mayorista es "cantidad en bultos, precio por
 * unidad": CANT 1, precio $1.766, importe $42.388 — un bulto de 24 con el
 * precio de cada pomo. El importe es el ancla: importe ÷ precio da las
 * unidades totales, en la unidad del precio, contando TODO lo facturado.
 *
 * Por eso, cuando la cantidad se corrige desde el importe, cualquier bulto del
 * renglón queda CONSUMIDO por esa corrección: 1 bulto × 24 → 24 unidades, y no
 * queda nada más que convertir. Tratarlos por separado ofrecía multiplicar de
 * nuevo (24 × 24 = 576 unidades a $74), que fue exactamente el bug.
 */
export function resolverCantidadYBulto(renglon: {
  cantidad?: number;
  precio?: number;
  importe?: number | null;
  unidadesPorBulto?: number | null;
}): RenglonResuelto {
  const cantidad = Number(renglon?.cantidad) || 0;
  const precio = Number(renglon?.precio) || 0;
  const importe = renglon?.importe == null ? null : Math.abs(Number(renglon.importe));
  const bulto = Number(renglon?.unidadesPorBulto) > 1 ? Math.round(Number(renglon!.unidadesPorBulto)) : null;
  const sinCambio: RenglonResuelto = { cantidad, unidadesPorBulto: bulto, cantidadOriginal: null, bultoConsumido: null };
  if (!cantidad || !precio || importe == null || importe === 0) return sinCambio;

  const esperado = cantidad * precio;
  if (Math.abs(importe - esperado) / esperado <= 0.02) return sinCambio; // cierra tal cual

  const q = importe / precio;
  const entero = Math.round(q);
  if (entero >= 1 && Math.abs(q - entero) <= 0.005 && entero !== cantidad) {
    return { cantidad: entero, unidadesPorBulto: null, cantidadOriginal: cantidad, bultoConsumido: bulto };
  }
  return sinCambio;
}
