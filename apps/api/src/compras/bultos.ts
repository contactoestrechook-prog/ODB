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
