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

/**
 * Lo que viene ADENTRO de cada unidad, no unidades que se venden sueltas.
 * "HILERET ZUCRA 8 X 50 SOBRES" es un bulto de 8 cajas de 50 sobres cada una:
 * el 50 son sobres, no cajas. Se leía al revés y entraban 50 unidades a $30 en
 * vez de 8 a $1.353 (Leandro, 10/9/2026). Nadie vende un sobre suelto.
 */
const RE_CONTENIDO = /^(sobres?|sobrecitos?|saquitos?|sachets?|c[aá]psulas?|tiras?|pastillas?|comprimidos?|rollos?|panuelos?|servilletas?|toallitas?|hojas?|fetas?)$/;

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
  return detectarBulto(descripcion)?.n ?? null;
}

/**
 * De dónde salió el «×N» de un renglón (6/10/2026). No pesan lo mismo:
 *  · 'palabra': la descripción lo dice con una palabra de caja ("CJ x 6",
 *    "PACK X 12"). Es lo más explícito que hay.
 *  · 'texto':   la descripción tiene la forma de un bulto ("x 24B", "6x750").
 *  · 'modelo':  la descripción no lo dice y lo puso solo el lector de la IA,
 *    casi siempre copiado de la columna de bultos del papel. Los Doritos de
 *    Mapaca ("200GX14") quedaron así: 28 UNIDADES marcadas como 28 cajas de 14.
 * Antes se guardaba solo el número y un 14 del modelo pesaba lo mismo que un
 * "CAJA X 14" escrito en el papel.
 */
export type OrigenBulto = 'palabra' | 'texto' | 'modelo';

export function bultoDelRenglon(descripcion: string, delModelo: unknown): { unidadesPorBulto: number | null; origen: OrigenBulto | null } {
  const delTexto = detectarBulto(descripcion);
  if (delTexto) return { unidadesPorBulto: delTexto.n, origen: delTexto.conPalabra ? 'palabra' : 'texto' };
  const m = Number(delModelo);
  return m > 1 && Number.isFinite(m) ? { unidadesPorBulto: Math.round(m), origen: 'modelo' } : { unidadesPorBulto: null, origen: null };
}

function detectarBulto(descripcion: string): { n: number; conPalabra: boolean } | null {
  const t = normalizar(descripcion);
  if (!t) return null;

  // 1) Palabra de bulto + número: "CJ x 6", "caja x12", "pack 6", "display 24".
  //    Es la forma más explícita, así que va primero.
  //    Sin borde de palabra al final: "CJx6" viene todo pegado. Las variantes
  //    largas van primero para que "cajon" no matchee como "caja".
  const porPalabra = t.match(
    /\b(?:cajon(?:es)?|cajas?|cja|cj|packs?|box|bultos?|display|bandejas?|bdj|estuche)\s*x?\s*(\d{1,3})\b/,
  );
  if (porPalabra && plausible(Number(porPalabra[1]))) return { n: Number(porPalabra[1]), conPalabra: true };

  // 2) Número + x + número de CONTENIDO: "8 x 50 sobres", "3 x 25 saquitos".
  //    El primero es el bulto; el segundo es lo que trae adentro cada unidad.
  const porContenido = t.match(/\b(\d{1,3})\s*x\s*(\d{1,4})\s*([a-z]+)\b/);
  if (porContenido && RE_CONTENIDO.test(porContenido[3]) && plausible(Number(porContenido[1]))) {
    return { n: Number(porContenido[1]), conPalabra: false };
  }

  // 3) Número + x + número de envase: "6x750", "12 x 1000cc".
  //    El chico es el pack y el grande el tamaño. El orden importa: en
  //    "355 X 24B" el primero es el tamaño, así que esta regla NO tiene que
  //    dispararse (la agarra la 3).
  const porEnvase = t.match(/\b(\d{1,2})\s*x\s*(\d{3,4})\s*(?:cc|ml|cm3|l|lt|lts|litros?)?\b/);
  if (porEnvase && plausible(Number(porEnvase[1])) && ES_TAMANO(Number(porEnvase[2]))) {
    return { n: Number(porEnvase[1]), conPalabra: false };
  }

  // 4) "x" + número, sin más. Es la forma más común y la que no se puede
  //    enumerar: cada bodega mete su abreviatura antes ("cc x 6", "SV x 6",
  //    "CJ x6", "x 24B"). En vez de listar las abreviaturas —que es lo que se
  //    rompe con el proveedor nuevo— se acepta cualquier cosa antes de la "x",
  //    y se filtra por lo que sigue: si el número es un tamaño de envase
  //    ("x 750", "x 1000cc") no es un bulto, y si no entra en 2..60 tampoco.
  for (const m of t.matchAll(/\bx\s*(\d{1,4})([.,]\d+)?\s*([a-z]*)/g)) {
    const n = Number(m[1]);
    const sufijo = m[3] ?? '';
    // "x12.5grs", "x 1,5 lts": un número con decimales es una medida, nunca un
    // bulto. El 15/9/2026 el bocadito Ferrero "x12.5grs" se leía caja de 12.
    if (m[2]) continue;
    if (!plausible(n)) continue; // 750, 1000, 2019… no son bultos
    // Una unidad de medida después del número descarta el bulto SOLO si ese
    // número podría ser esa medida de verdad. "x 2 L" es un envase de dos
    // litros; "SV x 6 cc" no es un envase de seis centímetros cúbicos —
    // ninguna bebida se vende así— es una caja de seis con la abreviatura de
    // la bodega al lado.
    if (/^(cc|ml|cm3)$/.test(sufijo) && n >= 50) continue;
    if (/^(l|lt|lts|litros?)$/.test(sufijo) && n <= 10) continue;
    // Un número pegado a una unidad de PESO es el gramaje del producto, no un
    // bulto: nadie factura "caja x 6 gr". Sin umbral, a propósito — el azafrán
    // viene en blíster de 2 gramos y con el piso de 50 se leía "bulto de 2".
    if (/^(g|gr|grs|grms|gra|gramos?)$/.test(sufijo)) continue;
    if (/^(kg|k|kilos?)$/.test(sufijo) && n <= 25) continue;
    // "x 50 sobres" sin un número de bulto adelante: la caja de 50 sobres ES la
    // unidad que se vende. No son 50 unidades sueltas.
    if (RE_CONTENIDO.test(sufijo)) continue;
    return { n, conPalabra: false };
  }

  // 5) Número + x AL FINAL del texto: "HWN DISPLAY MOGUL COLMILLO 12 x".
  //    Pasa cuando la columna de la factura corta la descripción justo después
  //    de la "x" (Arcor, 15/9/2026: 3 displays de 12 entraban como 3 unidades a
  //    $5.237). Lo que venía después —el gramaje— se perdió, pero "12 x" sigue
  //    siendo cuántas unidades trae el bulto.
  const alFinal = t.match(/\b(\d{1,3})\s*x\s*$/);
  if (alFinal && plausible(Number(alFinal[1]))) return { n: Number(alFinal[1]), conPalabra: false };

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
  // no puede superar a lo que rebaja. Con tolerancia de redondeo: el maní se
  // factura a $760,585 la unidad, el papel imprime 760,58 y el importe 1.521,17
  // — una rebaja del 100% "superaba" a la línea por un centavo y no se
  // vinculaba (2026-09-08).
  return d <= linea + Math.max(0.05, linea * 0.001);
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

// ---------------------------------------------------------------------------
// EL INTÉRPRETE ÚNICO DEL RENGLÓN
// ---------------------------------------------------------------------------
//
// Todo lo que puede "explicar" un renglón de factura gira alrededor de una
// sola pregunta: ¿por qué cantidad × precio no da el importe impreso? Las
// respuestas posibles se pisan entre sí (una bonificación parece medio kilo,
// un bulto parece una cantidad corregida), así que la precedencia tiene que
// estar en UN lugar, explícita, y no repartida en cinco reglas sueltas:
//
//   1. DESCUENTO ......... no es mercadería; es una rebaja sobre otro renglón.
//   2. BONIFICADO ........ la bonificación de la fila ya explica la diferencia.
//   3. PESO con columna .. la factura trae los kilos escritos y cierran.
//   4. CIERRA ............ cantidad × precio ≈ importe: no hay nada que
//                          interpretar; si hay bulto, queda PENDIENTE del
//                          operador ("Pasar a unidad")… salvo que la
//                          evidencia pruebe que la cantidad YA está en la
//                          unidad de stock (YA_EN_UNIDADES, 6/10/2026: ver
//                          evaluarBulto).
//   5. CANTIDAD .......... importe ÷ precio da un ENTERO ≠ cantidad: esa es la
//                          cantidad real, en la unidad del precio, y consume
//                          cualquier bulto (la corrección ES la conversión).
//   6. PESO implícito .... importe ÷ precio da DECIMAL y el producto puede
//                          venderse por peso: son kilos.
//   7. NO CIERRA ......... no se pudo deducir; se propone el precio que daría
//                          el importe y decide una persona.
//
// El importe es el ancla en todo: es el número que suma al neto del pie.

export type LecturaRenglon = {
  descripcion: string;
  cantidad: number;
  precio: number;
  importe: number | null;
  unidadesPorBulto: number | null;
  bonificacionPct: number | null;
  esDescuento: boolean;
  kg: number | null;
  puedePorPeso: boolean;
  /**
   * Unidades que ya expresa el producto del CATÁLOGO al que se vinculó
   * ("Azafran Alicante x 2" → 2). Cuando la casa vende el envase cerrado, el
   * precio impreso suele ser el de cada unidad de adentro y la cantidad de la
   * factura YA está en unidades de stock: no hay que multiplicar nada.
   */
  unidadesDelCatalogo?: number | null;
  /**
   * Costo actual del producto del catálogo (por SU unidad de stock). Desempata
   * si la factura viene por unidad suelta o por envase: $827 contra una caja
   * que cuesta $9.900 es precio de bocadito, no de caja.
   */
  costoCatalogo?: number | null;
  /** de dónde salió unidadesPorBulto (ver OrigenBulto) */
  bultoOrigen?: OrigenBulto | null;
  /**
   * Las columnas BULTOS y UNIDADES (sueltas) del papel, cuando existen.
   * Mapaca (6/10/2026): "2 bultos, 0 unidades, cantidad 28" prueba que los 28
   * ya son unidades (2 × 14 + 0 = 28). Sin estas columnas esa prueba se perdía.
   */
  bultos?: number | null;
  unidadesSueltas?: number | null;
  /**
   * El producto vinculado es una SUGERENCIA de la IA ("¿es este?"), no un
   * vínculo firme: ni su costo ni su presentación alcanzan para decidir solo.
   */
  vinculoSugerido?: boolean;
};

/**
 * Por qué un renglón con «×N» se convierte, no se convierte o queda para que
 * decida una persona (6/10/2026). Va a la pantalla tal cual.
 */
export type RazonBulto = {
  /**
   * 'unidades':  la cantidad del papel ya está en la unidad de stock (no se multiplica).
   * 'caja':      el producto del catálogo ES la caja de N (no se multiplica).
   * 'convertir': son cajas y el producto es la unidad suelta (× N).
   * null:        no hay con qué decidirlo.
   */
  sugerencia: 'unidades' | 'caja' | 'convertir' | null;
  evidencia: 'columna' | 'catalogo' | 'costo' | 'importe' | null;
  /** la cuenta que lo prueba, en castellano, para mostrar en el renglón */
  motivo: string;
};

export type RenglonInterpretado = {
  decision:
    | 'descuento'
    | 'bonificado'
    | 'peso_columna'
    | 'cierra'
    | 'bulto_pendiente'
    | 'ya_en_unidades'
    | 'cantidad_corregida'
    | 'precio_por_unidad_interna'
    | 'unidades_a_envase'
    | 'peso_implicito'
    | 'no_cierra';
  /** en la unidad final: unidades sueltas, bultos (si quedó pendiente) o kg */
  cantidad: number;
  porPeso: boolean;
  /** solo cuando la decisión quedó en manos del operador */
  unidadesPorBulto: number | null;
  /**
   * El «×N» que se leyó pero NO se aplica porque la evidencia probó que la
   * cantidad ya está en la unidad de stock (o que el producto es la caja).
   * Se conserva para que la pantalla lo muestre y se pueda deshacer.
   */
  bultoDescartado: number | null;
  /** por qué quedó así el bulto (pendiente con sugerencia, o descartado) */
  razonBulto: RazonBulto | null;
  cantidadOriginal: number | null;
  bultoConsumido: number | null;
  /** cuando no cierra: el unitario que SÍ daría el importe */
  precioPropuesto: number | null;
  /** descuento del renglón deducido del importe (la columna "Dto" no se leyó) */
  bonificacionPct: number | null;
  /**
   * El importe leído traía el IVA adentro (la lectura tomó la columna "Total c/IVA"):
   * este es el importe NETO que hay que usar. null = el importe leído ya era neto.
   */
  importeNeto: number | null;
  /** la alícuota que prueba ese importe con IVA (21, 10,5 o 27) */
  alicuotaDeducida: number | null;
};

const TOLERANCIA_CIERRE = 0.02; // el proveedor redondea el importe
const TOLERANCIA_ENTERO = 0.005;

/**
 * ¿Cuántas unidades expresa la PRESENTACIÓN de un nombre de producto?
 *
 * "Azafran Alicante x 2 x 0.2g" → 2 · "Yerba x 3 un" → 3 · "Coca 1,5 L" → null
 *
 * Se usa contra el producto del CATÁLOGO para saber si la unidad de stock de la
 * casa ya es el envase cerrado. Solo cuenta el multiplicador de unidades: el
 * tamaño del envase (750cc, 0.2g, 1.5L) nunca lo es.
 */
export function unidadesDeLaPresentacion(nombre: string): number | null {
  const t = normalizar(nombre);
  if (!t) return null;
  for (const m of t.matchAll(/\bx\s*(\d{1,3})([.,]\d+)?\s*([a-z]*)/g)) {
    const n = Number(m[1]);
    const sufijo = m[3] ?? '';
    if (m[2]) continue; // "x 12.5 gr" es el gramaje
    if (!plausible(n)) continue;
    // seguido de una medida es tamaño de envase, no cantidad de unidades
    if (/^(cc|ml|cm3|l|lt|lts|litros?|g|gr|grs|grms|gramos?|kg|k|kilos?)$/.test(sufijo)) continue;
    return n;
  }
  // "Ferrero Rocher T12", "T24": el código de bandeja de la marca
  const bandeja = t.match(/\bt(\d{1,2})\b/);
  if (bandeja && plausible(Number(bandeja[1]))) return Number(bandeja[1]);
  // "Blister 2U", "Pack 6U", "Tira 10 un"
  const porUnidades = t.match(/\b(\d{1,3})\s*(?:u|un|uni|unid|unidades?)\b/);
  if (porUnidades && plausible(Number(porUnidades[1]))) return Number(porUnidades[1]);
  return null;
}

// ---------------------------------------------------------------------------
// ¿LOS «×N» SON CAJAS O YA SON UNIDADES? (6/10/2026)
// ---------------------------------------------------------------------------
//
// Queja de Ana (administración): "en la fc dice 2 bultos en unidades marca 0 y
// la app no lo toma". MARINA MAPACA 0001-00281024: "DORITOS QUESO 200GX14"
// 28 × $4.899,65 = $137.190,20. El papel trae 2 bultos de 14 = 28 UNIDADES al
// precio de la unidad; el lector puso el 14 y la pantalla dio por hecho que
// los 28 eran cajas: ofrecía "Pasar a unidades" (392 a $350, mal) y no había
// forma de decir "ya vienen en unidades". La factura no se registró.
//
// El «×N» dice cuántas trae la caja; NO dice en qué unidad viene la cantidad.
// Eso lo prueba otra cosa, y acá se junta la evidencia, de la más dura a la
// más blanda. Siempre con el renglón que CIERRA (cantidad × precio = importe):
// el precio está en la misma unidad que la cantidad.
//
//   a) COLUMNA: bultos × N + sueltas = cantidad (y bultos ≠ cantidad) → la
//      cantidad ya son unidades. Si bultos = cantidad → la cantidad son cajas.
//   b) CATÁLOGO: el producto vinculado ya es el envase de N ("Palito Bombón
//      X 10") → la casa stockea la caja: no hay nada que convertir.
//   c) COSTO: el precio contra el costo del producto vinculado. Ese costo trae
//      IVA y percepciones (el neto cae cerca de 0,8), así que la banda es
//      ancha: 0,5 a 2. Si el precio tal cual cae adentro y el precio ÷ N no,
//      son unidades; al revés, son cajas; las dos adentro, se sugiere la más
//      cercana; las dos afuera (costo mal cargado), no se opina.
//
// Lo que se decide solo es NO multiplicar, y solo con evidencia firme y sin
// contradicciones (revisión del 6/10/2026, la misma tarde):
//   · la columna, si el costo no dice lo contrario (una sola lectura mal de
//     "0 bultos, 15 unidades" multiplicaba el costo de la lata por seis);
//   · el catálogo, si además el PRECIO prueba que es la caja (el Ferrero T8
//     a $823 contra la caja de 8 con costo 0 entraba como 12 cajas);
//   · el costo, solo cuando el «×N» lo puso el modelo y el papel no lo dice
//     (los Doritos de Mapaca). Con "X 24B" escrito, el costo con que se
//     compara puede ser el de la última compra de ese mismo renglón: si esa
//     vez la caja entró como unidad, la regla confirmaba el error en cada
//     factura y ya no avisaba. Ahí el costo solo sugiere.
// Convertir sigue siendo siempre decisión de una persona: acá se le deja la
// sugerencia y la cuenta.
const BANDA_COSTO_MIN = 0.5;
const BANDA_COSTO_MAX = 2;
const enBanda = (r: number) => Number.isFinite(r) && r >= BANDA_COSTO_MIN && r <= BANDA_COSTO_MAX;

/**
 * ¿El papel dice que el precio es de la unidad suelta? "Bocadito Ferrero T8
 * UNIDAD", "… UN." Un "10 un" con el número adelante es la presentación de la
 * caja ("X 10 UN"), no "por unidad".
 */
const dicePorUnidad = (descripcion: string | null | undefined) => {
  const t = normalizar(descripcion ?? '');
  return /\b(?:unidad|unid)\b/.test(t) || /(?<!\d\s*)\bun\b/.test(t);
};

const plata = (n: number) =>
  '$' + (Math.round(n * 100) / 100).toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

const numeroONull = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export function evaluarBulto(
  l: Pick<LecturaRenglon, 'bultos' | 'unidadesSueltas' | 'unidadesDelCatalogo' | 'costoCatalogo' | 'bultoOrigen' | 'vinculoSugerido'> & { descripcion?: string | null },
  cantidad: number,
  precio: number,
  n: number,
): (RazonBulto & { firme: boolean }) | null {
  if (!(n > 1) || !(cantidad > 0)) return null;

  // a) la columna de bultos del papel
  const bultos = numeroONull(l.bultos);
  const sueltasLeidas = numeroONull(l.unidadesSueltas);
  const sueltas = sueltasLeidas != null && sueltasLeidas > 0 ? sueltasLeidas : 0;
  const columnaDiceUnidades = bultos != null && bultos >= 0 && Math.abs(bultos * n + sueltas - cantidad) < 0.01 && Math.abs(bultos - cantidad) > 0.01;
  const columnaDiceCajas = bultos != null && bultos > 0 && sueltas === 0 && Math.abs(bultos - cantidad) < 0.01;

  // Lo que dice el precio contra el costo (la prueba c) se calcula primero:
  // la columna y el catálogo se cruzan con eso antes de decidir. Una evidencia
  // que contradice a la otra no alcanza para decidir solo (6/10/2026).
  const costo = Number(l.costoCatalogo) || 0;
  const conCosto = costo > 0 && precio > 0;
  const rUnidad = conCosto ? precio / costo : NaN;
  const rCaja = conCosto ? precio / n / costo : NaN;
  const costoDiceUnidades = conCosto && enBanda(rUnidad) && !enBanda(rCaja);
  const costoDiceCajas = conCosto && enBanda(rCaja) && !enBanda(rUnidad);

  // b) el producto del catálogo ya es la caja de N
  const internas = Number(l.unidadesDelCatalogo) > 1 ? Math.round(Number(l.unidadesDelCatalogo)) : null;
  if (internas === n) {
    if (columnaDiceUnidades) {
      // el papel trae unidades sueltas y la casa vende la caja: hay que armar
      // cajas (eso lo resuelve la regla 4 TER cuando la cuenta es exacta)
      return { sugerencia: null, evidencia: 'columna', firme: false, motivo: `el papel trae ${cantidad} unidades sueltas y el producto del catálogo es la caja de ${n}: revisá en qué unidad entra` };
    }
    // Que el producto sea la caja de N no prueba que el precio sea el de la
    // caja: "Bocadito Ferrero Rocher T8 UNIDAD" 12 × $823,05 contra "Ferrero
    // Rocher x 8 un" son 12 bocaditos sueltos (1,5 cajas), no 12 cajas. Se
    // decide solo si el precio cuadra con el costo de la caja (6/10/2026).
    const rSuelta = conCosto ? (precio * n) / costo : NaN;
    if (enBanda(rSuelta) && !enBanda(rUnidad)) {
      const enteras = Number.isInteger(cantidad / n);
      return {
        sugerencia: null, evidencia: 'costo', firme: false,
        motivo: `${plata(precio)} es precio de unidad suelta (× ${n} = ${plata(precio * n)}, y la caja de ${n} del catálogo cuesta ${plata(costo)})`
          + (enteras
            ? `: son ${cantidad / n} caja(s); elegí «Ya vienen en unidades» y después «Armar cajas»`
            : `: ${cantidad} unidades no arman cajas enteras de ${n}, revisá la cantidad o el producto`),
      };
    }
    const precioEsLaCaja = enBanda(rUnidad) && !enBanda(rSuelta);
    const firme = precioEsLaCaja && !l.vinculoSugerido && !dicePorUnidad(l.descripcion);
    return {
      sugerencia: 'caja', evidencia: 'catalogo', firme,
      motivo: precioEsLaCaja
        ? `el producto del catálogo ya es el envase de ${n} y ${plata(precio)} cuadra con su costo (${plata(costo)}): entra como viene`
        : `el producto del catálogo ya es el envase de ${n}${conCosto ? `, pero ${plata(precio)} no cuadra con su costo (${plata(costo)})` : ' y no tiene costo cargado para comprobar el precio'}`,
    };
  }

  if (columnaDiceUnidades) {
    const cuenta = `${bultos} × ${n}${sueltas > 0 ? ` + ${sueltas}` : ''} = ${cantidad}`;
    const dichoDelPapel = `el papel dice ${bultos} bulto(s) de ${n}${sueltas > 0 ? ` y ${sueltas} suelta(s)` : ''} (${cuenta})`;
    // Coca de Noria: "CC Lata 354 x 6" 15 × $8.760,92 con la lata a $1.663,52.
    // Si el lector devolviera "0 bultos, 15 sueltas", la columna sola dejaba
    // 15 latas a $8.760 (el costo × 6). Columna y costo en contra: pregunta.
    if (costoDiceCajas) {
      return {
        sugerencia: null, evidencia: 'costo', firme: false,
        motivo: `${dichoDelPapel}, pero ${plata(precio)} ÷ ${n} = ${plata(precio / n)} es lo que cuadra con el costo de catálogo (${plata(costo)}): revisá si la cantidad son cajas`,
      };
    }
    return { sugerencia: 'unidades', evidencia: 'columna', firme: true, motivo: `${dichoDelPapel}: la cantidad ya está en unidades` };
  }
  if (columnaDiceCajas) {
    if (costoDiceUnidades) {
      return {
        sugerencia: null, evidencia: 'costo', firme: false,
        motivo: `el papel dice ${bultos} bulto(s) y esa es la cantidad, pero ${plata(precio)} cuadra con el costo de catálogo (${plata(costo)}) de la unidad: revisá si son cajas o unidades`,
      };
    }
    return { sugerencia: 'convertir', evidencia: 'columna', firme: false, motivo: `el papel dice ${bultos} bulto(s) y esa es la cantidad: son cajas de ${n}` };
  }

  // c) el precio contra el costo del producto vinculado
  if (conCosto) {
    // Decide solo cuando el «×N» lo puso el modelo y el papel no lo dice (los
    // Doritos de Mapaca, "200GX14"). Con el bulto escrito en el papel ("CJ x 6",
    // "X 24B") o un vínculo que todavía es "¿es este?", el costo solo SUGIERE:
    // ese costo puede venir de la compra anterior del mismo renglón, y si esa
    // vez la caja entró como unidad, decidir solo repetía el error sin avisar.
    const puedeDecidir = l.bultoOrigen === 'modelo' && !l.vinculoSugerido;
    if (costoDiceUnidades) {
      return {
        sugerencia: 'unidades', evidencia: 'costo', firme: puedeDecidir,
        motivo: `${plata(precio)} cuadra con el costo de catálogo (${plata(costo)}); dividido por ${n} daría ${plata(precio / n)}`,
      };
    }
    if (costoDiceCajas) {
      return {
        sugerencia: 'convertir', evidencia: 'costo', firme: false,
        motivo: `${plata(precio)} ÷ ${n} = ${plata(precio / n)}, que cuadra con el costo de catálogo (${plata(costo)}) de la unidad`,
      };
    }
    if (enBanda(rUnidad) && enBanda(rCaja)) {
      const masCercaUnidad = Math.abs(Math.log(rUnidad)) <= Math.abs(Math.log(rCaja));
      return {
        sugerencia: masCercaUnidad ? 'unidades' : 'convertir', evidencia: 'costo', firme: false,
        motivo: `con el costo de catálogo (${plata(costo)}) podrían ser las dos; se parece más a ${masCercaUnidad ? `${plata(precio)} la unidad` : `${plata(precio / n)} la unidad (cajas de ${n})`}`,
      };
    }
  }
  return null;
}

/**
 * Aplica la evidencia a un renglón con «×N»: con evidencia firme de que no hay
 * que multiplicar, el bulto queda DESCARTADO (a la vista, con su porqué y
 * deshacer en la pantalla); si no, queda pendiente con la sugerencia.
 */
function conBulto(
  base: RenglonInterpretado,
  l: LecturaRenglon,
  cantidad: number,
  precio: number,
  n: number,
  siFirme: RenglonInterpretado['decision'],
  siPendiente: RenglonInterpretado['decision'],
): RenglonInterpretado {
  const ev = evaluarBulto(l, cantidad, precio, n);
  const razon: RazonBulto | null = ev ? { sugerencia: ev.sugerencia, evidencia: ev.evidencia, motivo: ev.motivo } : null;
  if (ev?.firme && (ev.sugerencia === 'unidades' || ev.sugerencia === 'caja')) {
    return { ...base, decision: siFirme, unidadesPorBulto: null, bultoDescartado: n, razonBulto: razon };
  }
  return { ...base, decision: siPendiente, unidadesPorBulto: n, razonBulto: razon };
}

export function interpretarRenglon(l: LecturaRenglon): RenglonInterpretado {
  const cantidad = Number(l.cantidad) || 1;
  const precio = Number(l.precio) || 0;
  const importeLeido = l.importe == null ? null : Math.abs(Number(l.importe));
  const bulto = Number(l.unidadesPorBulto) > 1 ? Math.round(Number(l.unidadesPorBulto)) : null;

  // 0 — IMPORTE CON EL IVA ADENTRO. Marolio (15/9/2026): "TE MAROLIO 25 UN.
  //     2 × $537,19 = $13.000". 2 × 10 × 537,19 = 10.743,80 y × 1,21 = 13.000,00
  //     exacto: la lectura tomó la columna del total con IVA. Sin esto salía
  //     "revisar lectura: ¿el precio es $6.500?" y el costo sumaba el IVA dos
  //     veces. Solo con evidencia dura: el importe dividido por (1 + alícuota)
  //     da un número ENTERO de unidades (la cantidad, o la cantidad × el bulto)
  //     y el importe tal cual no cerraba de ninguna forma.
  let importe = importeLeido;
  let importeNeto: number | null = null;
  let alicuotaDeducida: number | null = null;
  if (importe != null && importe > 0 && precio > 0 && cantidad > 0 && !l.esDescuento && !(Number(l.bonificacionPct) > 0)) {
    const cierraTalCual = Math.abs(importe - cantidad * precio) / (cantidad * precio) <= TOLERANCIA_CIERRE;
    const qLeido = importe / precio;
    const enteroLeido = Math.abs(qLeido - Math.round(qLeido)) <= TOLERANCIA_ENTERO;
    if (!cierraTalCual && !enteroLeido) {
      for (const a of [21, 10.5, 27]) {
        const neto = importe / (1 + a / 100);
        const q = neto / precio;
        // la cantidad puede ser kilos (Cabaña Piedras Blancas, 17/9/2026:
        // "QUESO BRIE 3,06 × $25.566,97 = $94.664,27" con IVA). Antes solo se
        // aceptaban enteros, el importe con IVA pasaba como neto y el peso
        // implícito inflaba los kilos un 21% (3,06 → 3,703), bajando el costo
        // de TODA la factura al repartir el pie.
        const cerca = (x: number) => Math.abs(q - x) <= 0.0005 * Math.max(1, x);
        const esCantidad = cerca(cantidad) || (bulto != null && cerca(cantidad * bulto));
        if (esCantidad) {
          importe = Math.round(neto * 100) / 100;
          importeNeto = importe;
          alicuotaDeducida = a;
          break;
        }
      }
    }
  }
  const bonif = Math.min(100, Math.abs(Number(l.bonificacionPct) || 0));
  const kg = Number(l.kg) || 0;

  const base: RenglonInterpretado = {
    decision: 'cierra',
    cantidad,
    porPeso: false,
    unidadesPorBulto: bulto,
    bultoDescartado: null,
    razonBulto: null,
    cantidadOriginal: null,
    bultoConsumido: null,
    precioPropuesto: null,
    bonificacionPct: null,
    importeNeto,
    alicuotaDeducida,
  };

  // 1 — rebaja, no mercadería
  if (l.esDescuento || esRenglonDeDescuento({ descripcion: l.descripcion, precio: l.precio })) {
    return { ...base, decision: 'descuento', unidadesPorBulto: null };
  }

  // 2 — la bonificación de la fila ya explica el descuadre; el bulto (si hay)
  //     sigue siendo decisión del operador: una caja regalada sigue siendo caja.
  //     Si el importe cierra con la bonificación, la cantidad y el precio están
  //     en la misma unidad y vale la misma evidencia que en la regla 4
  //     (6/10/2026: 28 Doritos sin cargo siguen siendo 28 unidades).
  if (bonif > 0) {
    if (bulto && precio > 0 && cantidad > 0 && importe != null) {
      const lista = cantidad * precio;
      const cierraConBonif = Math.abs(importe - lista * (1 - bonif / 100)) <= Math.max(0.05, lista * TOLERANCIA_CIERRE);
      if (cierraConBonif) return conBulto(base, l, cantidad, precio, bulto, 'bonificado', 'bonificado');
    }
    return { ...base, decision: 'bonificado' };
  }

  // 3 — peso con columna: evidencia escrita, y tiene que cerrar con el importe.
  //     Si la columna de kilos repite la cantidad (3,06 y 3,06) también es peso.
  if (l.puedePorPeso && kg > 0 && precio > 0 && (Math.abs(kg - cantidad) > 0.01 || !Number.isInteger(kg))) {
    const esperado = kg * precio;
    const cierra = importe == null || esperado <= 0 || Math.abs(importe - esperado) / esperado < 0.05;
    if (cierra) {
      return { ...base, decision: 'peso_columna', cantidad: kg, porPeso: true, unidadesPorBulto: null };
    }
  }

  // sin importe o sin precio no hay más nada que deducir
  if (importe == null || importe === 0 || precio <= 0 || cantidad <= 0) {
    return bulto ? { ...base, decision: 'bulto_pendiente' } : base;
  }

  // 4 — cierra tal cual
  const esperado = cantidad * precio;
  const internasCatalogo = Number(l.unidadesDelCatalogo) > 1 ? Math.round(Number(l.unidadesDelCatalogo)) : null;
  if (Math.abs(importe - esperado) / esperado <= TOLERANCIA_CIERRE) {
    // 4 TER — la factura viene por UNIDAD SUELTA y la casa stockea el ENVASE.
    //     Ferrero (15/9/2026): "Bocadito Ferrero Rocher T12 UNIDAD" 60 × $827,49
    //     vinculado a "Ferrero Rocher x 12 un": son 5 cajas a $9.929,88, no 60
    //     cajas (ni 720 unidades). Vienen en x3, x8, x12 y x24. Se convierte
    //     solo con evidencia: la cantidad es múltiplo exacto del envase y el
    //     precio impreso es de unidad (contra el costo del catálogo, o porque
    //     el papel dice "UNIDAD"). Si no hay evidencia, queda como está y la
    //     pantalla ofrece "armar cajas" a mano.
    if (internasCatalogo && cantidad >= internasCatalogo && Number.isInteger(cantidad / internasCatalogo)) {
      const costo = Number(l.costoCatalogo) || 0;
      // la columna de bultos del papel también lo prueba: "2 bultos, 0
      // sueltas, cantidad 24" con el catálogo en cajas de 12 (6/10/2026)
      const bultosCol = numeroONull(l.bultos);
      const sueltasCol = numeroONull(l.unidadesSueltas) ?? 0;
      // …salvo que el costo diga lo contrario: el precio cuadra con la caja y
      // no con la unidad suelta. Ahí la columna se leyó mal (o es de otra
      // fila) y armar cajas multiplicaba el costo por N (6/10/2026).
      const costoDiceCaja = costo > 0 && enBanda(precio / costo) && !enBanda((precio * internasCatalogo) / costo);
      const columnaLoPrueba = bultosCol != null && bultosCol > 0 && sueltasCol === 0
        && Math.abs(bultosCol * internasCatalogo - cantidad) < 0.01 && !costoDiceCaja;
      const porUnidad = columnaLoPrueba || (costo > 0
        ? Math.abs(precio * internasCatalogo - costo) < Math.abs(precio - costo)
        : /\b(unidad|unid|un|u)\b/.test(normalizar(l.descripcion)));
      if (porUnidad) {
        return {
          ...base,
          decision: 'unidades_a_envase',
          cantidad: cantidad / internasCatalogo,
          unidadesPorBulto: null,
          cantidadOriginal: cantidad,
          precioPropuesto: Math.round(precio * internasCatalogo * 100) / 100,
        };
      }
    }
    // 4 QUATER — «×N» con la cuenta cerrada: ¿cajas o ya unidades? (6/10/2026)
    return bulto ? conBulto(base, l, cantidad, precio, bulto, 'ya_en_unidades', 'bulto_pendiente') : base;
  }

  const q = importe / precio;
  const entero = Math.round(q);

  // 4 BIS — envase CERRADO que la casa vende entero (blíster de azafrán, pack
  //     de especias). El proveedor imprime el precio de cada unidad de ADENTRO
  //     y el importe del renglón es por el envase completo: 1 blíster × 2
  //     unidades × $2.338,18 = $4.676. Antes esto se "corregía" a 2 unidades y
  //     entraban al stock dos artículos que no existen sueltos.
  //
  //     La señal que lo distingue de un bulto de reventa (Corona x24, que SÍ se
  //     desarma) es el producto del catálogo: si la unidad de stock de la casa
  //     ya es el envase de N, no hay nada que convertir. La cantidad queda como
  //     vino en la factura y el costo del renglón es el importe.
  const internas = Number(l.unidadesDelCatalogo) > 1 ? Math.round(Number(l.unidadesDelCatalogo)) : null;
  if (internas && entero === cantidad * internas && Math.abs(q - entero) <= TOLERANCIA_ENTERO) {
    return {
      ...base,
      decision: 'precio_por_unidad_interna',
      cantidad,
      unidadesPorBulto: null,
      precioPropuesto: Math.round((importe / cantidad) * 100) / 100,
    };
  }

  // 5 — la cantidad real sale del importe; consume el bulto
  if (entero >= 1 && Math.abs(q - entero) <= TOLERANCIA_ENTERO && entero !== cantidad) {
    return {
      ...base,
      decision: 'cantidad_corregida',
      cantidad: entero,
      unidadesPorBulto: null,
      cantidadOriginal: cantidad,
      bultoConsumido: bulto,
    };
  }

  // DESCUENTO DEL RENGLÓN que la lectura no trajo como columna.
  //     Distri Sur (15/9/2026): "Tom.Triturado 18 × $2.345,25 = $40.103,82".
  //     18 × 2.345,25 = 42.214,50 y el importe es EXACTO un 5% menos; igual en
  //     garbanzo, mayonesa y lentejón, y −3% en las tostadas. Se mostraba como
  //     "revisar lectura: ¿el precio es $2.228?", como si el lector se hubiera
  //     equivocado, cuando el papel está bien y es un descuento.
  //     Evidencia dura, igual que la del entero de la regla 5: un porcentaje
  //     REDONDO (múltiplo de 0,5, hasta 50%) que cierra al centavo. Un error de
  //     lectura no cae justo en −5,000%. Con bulto, se mide contra las unidades
  //     de adentro (la caja de 12 de tostadas).
  const descuentoDelRenglon = (): RenglonInterpretado | null => {
    const unidades = cantidad * (bulto ?? 1);
    for (const u of bulto ? [unidades, cantidad] : [cantidad]) {
      const lista = u * precio;
      if (!(lista > 0) || importe >= lista) continue;
      const pct = (1 - importe / lista) * 100;
      const redondo = Math.round(pct * 2) / 2;
      if (redondo >= 1 && redondo <= 50 && Math.abs(lista * (1 - redondo / 100) - importe) <= Math.max(0.05, lista * 0.0002)) {
        const conDescuento = { ...base, decision: 'bonificado' as const, bonificacionPct: redondo };
        if (!bulto) return { ...conDescuento, unidadesPorBulto: null };
        // el importe solo cierra contando las N de cada caja: la cantidad son
        // cajas, eso lo prueba el papel (las tostadas de a 12)
        if (u === unidades) {
          return {
            ...conDescuento,
            unidadesPorBulto: bulto,
            razonBulto: { sugerencia: 'convertir', evidencia: 'importe', motivo: `el importe solo cierra contando las ${bulto} de cada caja (con ${redondo}% de descuento)` },
          };
        }
        // cierra con la cantidad tal cual: precio y cantidad en la misma
        // unidad. Antes el bulto se borraba sin avisar; ahora se juzga igual
        // que en la regla 4 (6/10/2026)
        return conBulto(conDescuento, l, cantidad, precio, bulto, 'bonificado', 'bonificado');
      }
    }
    return null;
  };

  // 6 — decimal + producto fraccionable = kilos. PERO una cantidad entera de 2
  //     o más con un descuento redondo exacto es descuento, no peso: la
  //     "Mayonesa Heinz x350 Grs" (el "Grs" la hace fraccionable) entraba como
  //     9,5 kg en vez de 10 unidades con 5% off. Con cantidad 1 el peso sigue
  //     ganando: una horma de 0,95 kg es tan posible como un 5% de descuento.
  const cantidadEntera = Number.isInteger(cantidad) && cantidad >= 2;
  if (cantidadEntera) {
    const d = descuentoDelRenglon();
    if (d) return d;
  }
  // (regla 6)
  if (l.puedePorPeso && !bulto && Math.abs(q - cantidad) > 0.01) {
    return {
      ...base,
      decision: 'peso_implicito',
      cantidad: Math.round(q * 1000) / 1000,
      porPeso: true,
      unidadesPorBulto: null,
    };
  }

  // 6 BIS — el descuento redondo con cantidad 1 (o fraccionaria), si no fue peso
  {
    const d = descuentoDelRenglon();
    if (d) return d;
  }

  // 7 — no se pudo deducir: que decida una persona, con el dato servido
  return {
    ...base,
    decision: 'no_cierra',
    precioPropuesto: Math.round((importe / cantidad) * 100) / 100,
  };
}

export type LineaDeCosteo = {
  sku: string;
  cantidad: number;
  /** precio de lista impreso del renglón: define el grupo de la promo */
  precioLista: number;
  /** lo que efectivamente se paga por el renglón completo (0 si es sin cargo) */
  pagado: number;
};

/**
 * Reparte la mercadería sin cargo entre el GRUPO que la ganó, no solo entre su
 * propio producto.
 *
 * El arreglo comercial real es "comprá 10 cajas de la línea, llevate 1 gratis":
 * la caja regalada la ganaron TODOS los varietales del grupo, y el cliente
 * quiere el costo repartido así. ¿Cómo sabe el sistema cuál es el grupo? Está
 * impreso: son los renglones con el MISMO precio de lista. En la factura de
 * Wiwo, la Monteagrelo gratis comparte precio con Malbec, Cabernet y Franc
 * (todos $173.553,72) — ese es su grupo; la Cupra Rose gratis solo comparte
 * precio con la Rose paga, y el Pinot ($357.024,79) queda afuera solo.
 *
 * La cuenta: costo por unidad del grupo = todo lo pagado por el grupo ÷ todas
 * las unidades recibidas (pagas + gratis). La suma de costos da lo pagado al
 * centavo. Solo se activa si el grupo tiene mercadería sin cargo; si no, cada
 * renglón conserva su propio costo.
 */
export function costearConGruposPromo(
  lineas: LineaDeCosteo[],
): Map<string, { cantidad: number; costo: number; grupoPromo: boolean }> {
  const clavePrecio = (p: number) => String(Math.round(Number(p) * 100));

  // qué grupos de precio tienen mercadería sin cargo
  const grupos = new Map<string, { pagado: number; unidades: number; tieneGratis: boolean }>();
  for (const l of lineas) {
    const k = clavePrecio(l.precioLista);
    const g = grupos.get(k) ?? { pagado: 0, unidades: 0, tieneGratis: false };
    g.pagado += Number(l.pagado) || 0;
    g.unidades += Number(l.cantidad) || 0;
    if ((Number(l.pagado) || 0) < 0.01 && (Number(l.cantidad) || 0) > 0) g.tieneGratis = true;
    grupos.set(k, g);
  }

  const salida = new Map<string, { cantidad: number; costo: number; grupoPromo: boolean }>();
  for (const l of lineas) {
    const cantidad = Number(l.cantidad) || 0;
    if (cantidad <= 0) continue;
    const g = grupos.get(clavePrecio(l.precioLista))!;
    const enPromo = g.tieneGratis && g.unidades > 0;
    const costo = enPromo ? g.pagado / g.unidades : (Number(l.pagado) || 0) / cantidad;
    const prev = salida.get(l.sku);
    if (!prev) salida.set(l.sku, { cantidad, costo: 0, grupoPromo: enPromo });
    else { prev.cantidad += cantidad; prev.grupoPromo = prev.grupoPromo || enPromo; }
    // el costo del SKU es el promedio ponderado de sus líneas (puede estar en
    // dos grupos distintos, o tener líneas con y sin promo)
    const acumulado = salida.get(l.sku)!;
    (acumulado as any)._total = ((acumulado as any)._total ?? 0) + cantidad * costo;
    acumulado.costo = Math.round(((acumulado as any)._total / acumulado.cantidad) * 100) / 100;
  }
  for (const v of salida.values()) delete (v as any)._total;
  return salida;
}


/**
 * Variación % entre el precio leído y el costo actual del producto, comparando
 * POR UNIDAD: si el renglón viene por caja de N, el precio leído es el de la
 * caja. Compararlo contra el costo unitario daba "+42543%" y degradaba
 * vínculos buenos a "¿es este?" (2026-09-08).
 */
export function variacionPorUnidad(precioLeido: number, unidadesPorBulto: number | null | undefined, costoActual: number | null | undefined): number | null {
  const costo = Number(costoActual);
  if (!(costo > 0)) return null;
  const bulto = Number(unidadesPorBulto);
  const porUnidad = bulto > 1 ? Number(precioLeido) / bulto : Number(precioLeido);
  if (!Number.isFinite(porUnidad)) return null;
  return Math.round(((porUnidad - costo) / costo) * 1000) / 10;
}

/**
 * La variación del renglón con la interpretación DEFINITIVA (6/10/2026).
 *
 * Antes se calculaba una sola vez, al vincular, con el «×N» que puso el lector:
 * los 28 Doritos que ya eran unidades salían "costo −93,9%" ($4.899,65 ÷ 14 =
 * $350 contra $5.714) y la tarjeta gritaba en rojo algo falso. Se divide por N
 * solo si el bulto sigue pendiente y nada dice que ya son unidades; con el
 * envase armado (Ferrero) se compara el precio del envase.
 */
export function variacionDelRenglon(
  precioLeido: number | null | undefined,
  r: Pick<RenglonInterpretado, 'decision' | 'unidadesPorBulto' | 'precioPropuesto'> & { razonBulto?: RazonBulto | null },
  costoActual: number | null | undefined,
): number | null {
  const precio = Number(precioLeido);
  if (!(precio > 0)) return null;
  const sugiereNoConvertir = r.razonBulto?.sugerencia === 'unidades' || r.razonBulto?.sugerencia === 'caja';
  const bulto = Number(r.unidadesPorBulto) > 1 && !sugiereNoConvertir ? Number(r.unidadesPorBulto) : null;
  const precioFinal = (r.decision === 'unidades_a_envase' || r.decision === 'precio_por_unidad_interna') && Number(r.precioPropuesto) > 0
    ? Number(r.precioPropuesto)
    : precio;
  return variacionPorUnidad(precioFinal, bulto, costoActual);
}
