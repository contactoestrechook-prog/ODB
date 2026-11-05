// ============================================================
// IMPUESTOS INTERNOS, SOLO A LOS PRODUCTOS QUE LOS PAGAN (3/11/2026)
// Leandro: «está mal, pésimo, nunca más puede pasar eso». El panel repartía
// los internos del pie entre TODOS los renglones: en La Serenísima
// 06376-00001046 los $7.148,01 eran el 8,7 % de los dos bebibles de almendra
// ($82.161, al centavo) y terminaban también en la leche, los quesos y la
// manteca. La leche costaba $4,25 de más y los bebibles, $234 de menos.
//
// El interno no lo paga cualquier cosa: bebidas sin alcohol, alcohol, cerveza
// y tabaco. Los lácteos no. A quién va, en orden:
//  1) a los renglones que una persona marcó «lleva internos»;
//  2) al grupo de renglones que pueden llevarlos (por su texto) cuya suma, a
//     una de las tasas de la ley, da el interno del pie al centavo, si hay uno
//     solo;
//  3) si no cierra o no hay a quién: NO se reparte. La factura no se registra
//     hasta que alguien marque los renglones. Nunca un promedio en silencio.
//
// Funciones puras; se prueban en apps/api/src/compras/internos-compras.spec.ts.
// ============================================================

export type RenglonInternos = {
  /** el texto del papel y el nombre del producto vinculado */
  descripcion?: string | null;
  /** neto del renglón (cantidad × precio, ya con su descuento) */
  neto: number;
  /** lo marcó una persona: true lleva internos, false no; null lo decide la cuenta */
  marcado?: boolean | null;
};

export type AsignacionInternos =
  | { estado: 'sin_internos' }
  | {
      /** «cierra»: lo prueba la cuenta; «marcados»: lo dijo una persona */
      estado: 'cierra' | 'marcados';
      indices: number[];
      /** índice del renglón → internos que le tocan (en pesos, el renglón entero) */
      porIdx: Map<number, number>;
      /** la tasa efectiva sobre el neto, en % (solo cuando lo prueba la cuenta) */
      tasa: number | null;
      base: number;
    }
  | {
      /** hay renglones que pueden llevarlos pero ningún grupo cierra (o cierra más de uno) */
      estado: 'dudoso';
      candidatos: number[];
    }
  | { estado: 'sin_destino' };

const sinAcentos = (t: unknown) =>
  String(t ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

// Lo que paga internos (Ley 24.674): bebidas sin alcohol (gaseosas, aguas
// saborizadas, jugos, energizantes, bebibles), cervezas, bebidas alcohólicas,
// tabaco. Los vinos están exentos.
const LLEVA = /\b(beb|bebible|bebibles|bebida|bebidas|gaseosa|gaseosas|saborizada|saborizadas|tonica|jugo|jugos|nectar|energizante|energizantes|isotonica|isotonico|cerveza|cervezas|fernet|whisky|vodka|gin|ron|aperitivo|aperitivos|licor|licores|vermut|vermouth|sidra|espumante|champagne|champana|cigarrillos|cigarrillo|cigarro|cigarros|tabaco|coca|pepsi|sprite|fanta|7up|speed|monster|gatorade|powerade|aquarius|levite|cepita|baggio|schweppes|paso de los toros|quilmes|brahma|stella|heineken|corona|campari|gancia|branca)\b/;
// lo que NO paga aunque comparta palabras («leche chocolatada», «dulce de leche»)
const NO_LLEVA = /\b(leche|yogur|yogurt|yogurisimo|queso|quesos|manteca|crema|postre|flan|dulce de leche|actimel|danonino)\b/;

/** ¿El renglón puede llevar impuestos internos, por lo que dice? */
export function puedeLlevarInternos(descripcion: unknown): boolean {
  const t = sinAcentos(descripcion);
  return !!t && LLEVA.test(t) && !NO_LLEVA.test(t);
}

/**
 * Tasas efectivas sobre el neto, en %. La ley fija la tasa sobre el precio que
 * ya incluye el impuesto, así que sobre el neto queda t / (1 − t): el 8 % de
 * las bebidas sin alcohol es 8,6957 % (y hay facturas que lo redondean a
 * 8,70 %, como La Serenísima). Están también las tasas nominales, por si el
 * proveedor las aplica directo sobre el neto.
 */
export const TASAS_INTERNOS = [
  8 / 0.92, 8.7, 8, // bebidas sin alcohol
  4 / 0.96, 4.17, 4, // jugos con fruta, bebidas con reducción
  14 / 0.86, 14, // cervezas
  20 / 0.8, 20, // alcohólicas
  26 / 0.74, 26, // whisky y destilados
  10 / 0.9, 10,
].map((t) => Math.round(t * 10000) / 10000);

const redondear = (n: number) => Math.round(n * 100) / 100;
const tolerancia = (internos: number) => Math.max(0.05, Math.abs(internos) * 0.00002);

// Más de 14 candidatos son demasiadas combinaciones para buscar todas (y con
// tantas, alguna cierra por casualidad): se prueba solo con todos juntos.
const MAX_BUSQUEDA = 14;

function repartir(indices: number[], netos: number[], internos: number): Map<number, number> {
  const base = indices.reduce((s, k) => s + netos[k], 0);
  const porIdx = new Map<number, number>();
  if (!(base > 0)) return porIdx;
  // proporcional al neto; el último se lleva el redondeo para cerrar al centavo
  let asignado = 0;
  indices.forEach((k, n) => {
    const parte = n === indices.length - 1 ? redondear(internos - asignado) : redondear(internos * (netos[k] / base));
    asignado = redondear(asignado + parte);
    porIdx.set(k, parte);
  });
  return porIdx;
}

export function asignarInternos(renglones: RenglonInternos[], internos: number): AsignacionInternos {
  if (!(internos > 0)) return { estado: 'sin_internos' };
  const netos = renglones.map((r) => (Number.isFinite(r.neto) && r.neto > 0 ? r.neto : 0));

  // 1) lo que marcó una persona manda
  const marcados = renglones.map((r, k) => (r.marcado === true && netos[k] > 0 ? k : -1)).filter((k) => k >= 0);
  if (marcados.length) {
    const base = marcados.reduce((s, k) => s + netos[k], 0);
    return { estado: 'marcados', indices: marcados, porIdx: repartir(marcados, netos, internos), tasa: null, base };
  }

  // 2) los que pueden llevarlos, por su texto (y que nadie descartó)
  const candidatos = renglones
    .map((r, k) => (netos[k] > 0 && r.marcado !== false && puedeLlevarInternos(r.descripcion) ? k : -1))
    .filter((k) => k >= 0);
  if (!candidatos.length) return { estado: 'sin_destino' };

  const tol = tolerancia(internos);
  const encontrados: { indices: number[]; tasa: number; base: number }[] = [];
  const probar = (indices: number[]) => {
    const base = redondear(indices.reduce((s, k) => s + netos[k], 0));
    for (const tasa of TASAS_INTERNOS) {
      if (Math.abs(redondear(base * tasa / 100) - internos) <= tol) { encontrados.push({ indices, tasa, base }); return; }
    }
  };
  if (candidatos.length <= MAX_BUSQUEDA) {
    for (let m = 1; m < 1 << candidatos.length; m++) probar(candidatos.filter((_, b) => m & (1 << b)));
  } else {
    probar(candidatos);
  }
  if (encontrados.length === 1) {
    const e = encontrados[0];
    return { estado: 'cierra', indices: e.indices, porIdx: repartir(e.indices, netos, internos), tasa: e.tasa, base: e.base };
  }
  // ninguno cierra, o cierran varios: que lo decida una persona
  return { estado: 'dudoso', candidatos };
}

/**
 * CIGARRILLOS (5/11/2026): la factura imprime el impuesto interno POR UNIDAD en
 * cada renglón. Si lo impreso suma el interno del pie, no hay nada que
 * adivinar: cada renglón lleva el suyo. null = no viene impreso o no da el pie
 * (sigue la regla de arriba).
 */
export function internosImpresos(delPapel: (number | null | undefined)[], internos: number): Extract<AsignacionInternos, { indices: number[] }> | null {
  if (!(internos > 0)) return null;
  const valores = delPapel.map((v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0));
  const indices = valores.map((v, k) => (v > 0 ? k : -1)).filter((k) => k >= 0);
  const base = redondear(indices.reduce((s, k) => s + valores[k], 0));
  // el papel redondea el interno por unidad: se admite medio por ciento
  if (!indices.length || Math.abs(base - internos) > Math.max(1, internos * 0.005)) return null;
  // cada renglón el suyo; el redondeo del papel va al último, para dar el pie al centavo
  const porIdx = new Map<number, number>();
  let asignado = 0;
  indices.forEach((k, m) => {
    const parte = m === indices.length - 1 ? redondear(internos - asignado) : redondear(valores[k]);
    asignado = redondear(asignado + parte);
    porIdx.set(k, parte);
  });
  return { estado: 'cierra' as const, indices, porIdx, tasa: null, base };
}

/**
 * Las percepciones se calculan sobre el neto MÁS los impuestos internos (en
 * las dos facturas de Grupo Modo del 4/11/2026 la de IIBB es el 5 % exacto de
 * neto + internos). Repartidas solo sobre el neto, en una factura que mezcla
 * cigarrillos y almacén las barras de cereal pagaban la percepción de los
 * cigarrillos. Devuelve la fracción que se le suma a cada peso de neto y de
 * interno. Sin internos es lo de siempre: percepciones ÷ neto.
 */
export function pctPercepciones(percepciones: number, neto: number, internos: number): number {
  const base = (Number(neto) || 0) + Math.max(0, Number(internos) || 0);
  return base > 0 && percepciones > 0 ? percepciones / base : 0;
}

/** Lo que dice la pantalla, en una línea. */
export function textoInternos(
  a: AsignacionInternos,
  internos: number,
  pesos: (n: number) => string,
  /** el número de renglón que ve la persona (los índices son de los renglones que se pasaron) */
  renglonDe: (k: number) => number = (k) => k + 1,
): string {
  const nros = (xs: number[]) => {
    const r = xs.map(renglonDe);
    return r.length === 1 ? `el renglón ${r[0]}` : `los renglones ${r.slice(0, -1).join(', ')} y ${r[r.length - 1]}`;
  };
  if (a.estado === 'cierra') {
    if (a.tasa == null) return `Impuestos internos ${pesos(internos)}: van a ${nros(a.indices)}, cada uno con el que trae impreso en su renglón. Los demás productos no los pagan.`;
    return `Impuestos internos ${pesos(internos)}: van a ${nros(a.indices)} (${String(a.tasa).replace('.', ',')} % sobre ${pesos(a.base)}, cierra al centavo). Los demás productos no los pagan.`;
  }
  if (a.estado === 'marcados') return `Impuestos internos ${pesos(internos)}: van a ${nros(a.indices)}, como se marcó. Los demás productos no los pagan.`;
  if (a.estado === 'dudoso') {
    return `Impuestos internos ${pesos(internos)}: no se sabe con certeza a qué productos van. Pueden ser ${nros(a.candidatos)}: marcá en cada renglón si los lleva.`;
  }
  if (a.estado === 'sin_destino') {
    return `Impuestos internos ${pesos(internos)}: ningún renglón parece llevarlos (bebidas, alcohol, cerveza o tabaco). Marcá en cada renglón si los lleva.`;
  }
  return '';
}
