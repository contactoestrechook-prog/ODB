// ============================================================
// TAMAÑO DE CADA BOTELLA (16/9/2026)
//
// Un cliente pidió whisky "de más de 1 litro, 2 o 3 litros, para regalo" y el
// bot contestó que el tamaño máximo era 1 L, habiendo un Chivas 12 balancín de
// 4,5 L con stock (Leandro: "error grave"). La búsqueda le pasaba 89 whiskies
// con la medida enterrada en el nombre ("x4.5Lt", "3000 CC", "1lt") y el modelo
// no la vio. Ahora la medida viaja aparte y los formatos grandes van con aviso.
// ============================================================

const norm = (t: string) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Mililitros que dice el nombre: "x4.5Lt" → 4500, "3000 CC" → 3000, "x1l" → 1000. */
export function volumenMl(nombre: string | null | undefined): number | null {
  const t = norm(nombre ?? '');
  const cc = t.match(/(\d{2,5}(?:[.,]\d+)?)\s*(?:cc|ml|cm3)(?![a-z])/);
  if (cc) {
    const n = Number(cc[1].replace(',', '.'));
    if (n >= 50 && n <= 20000) return Math.round(n);
  }
  const l = t.match(/(\d{1,2}(?:[.,]\d{1,3})?)\s*(?:l|lt|lts|ltr|litros?)(?![a-z])/);
  if (l) {
    const n = Number(l[1].replace(',', '.'));
    if (n > 0 && n <= 20) return Math.round(n * 1000);
  }
  return null;
}

export function etiquetaVolumen(ml: number | null | undefined): string | null {
  if (!ml) return null;
  if (ml >= 1000) return `${String(ml / 1000).replace('.', ',')} L`;
  return `${ml} cc`;
}

/** ¿El cliente pide un tamaño? "más de 1 litro", "2 o 3 litros", "grande", "balancín". */
export function pideTamano(texto: string | null | undefined): { ml: number | null; grande: boolean } | null {
  const t = norm(texto ?? '');
  const grande = /\b(grandes?|balanc[i]n(es)?|magnum|galon(es)?|mas de|mayor(es)? a|de mas)\b/.test(t);
  const ml = volumenMl(t.replace(/\bun litro\b/, '1 l').replace(/\bmedio litro\b/, '500 cc'));
  if (!ml && !grande) return null;
  return { ml, grande: grande || (ml ?? 0) > 1000 };
}

/** Palabras que no son marca: tamaño, relleno, pedidos genéricos. */
export const PALABRA_GENERICA = /^(de|del|la|el|los|las|en|con|x|por|para|mas|menos|o|y|un|una|botella|botellas|litro|litros|lt|lts|l|cc|ml|grande|grandes|chico|chica|balancin|magnum|regalo|opciones|tienen|hay|precio|precios|stock|\d+([.,]\d+)?(l|lt|cc|ml)?)$/;

/**
 * La medida que el cliente escribe partida: "coca de 2 litros 25" es 2,25 L,
 * "1 litro 5" es 1,5 L (Nahuel Hijo Favir, 18/9/2026: el bot leyó "2 litros" y
 * cantidad 25, y le contestó que el formato más grande era el de 1,75 L).
 */
export function medidaPartida(texto: string | null | undefined): number | null {
  const t = norm(texto ?? '').replace(/,/g, '.');
  const m = t.match(/\b(\d)\s*(?:l|lt|lts|litros?)\s*(?:y\s*)?(\d{1,2})\b(?!\s*(?:cc|ml|g|gr|kg))/);
  if (m) {
    const dec = m[2].length === 1 ? Number(m[2]) / 10 : Number(m[2]) / 100;
    const litros = Number(m[1]) + dec;
    if (litros > 0 && litros <= 10) return Math.round(litros * 1000);
  }
  if (/\b(litro y medio|1 litro y medio)\b/.test(t)) return 1500;
  if (/\b(\d)\s*(?:l|lt|litros?)\s*y\s*cuarto\b/.test(t)) return Number(RegExp.$1) * 1000 + 250;
  return null;
}

/** Tamaños del catálogo para lo que se buscó, con y sin stock: "1,75 L (hay) · 2,25 L (sin stock)". */
export function resumenDeTamanos(conStock: string[], sinStock: string[]): string | null {
  const mapa = new Map<number, boolean>();
  for (const n of conStock) { const ml = volumenMl(n); if (ml) mapa.set(ml, true); }
  for (const n of sinStock) { const ml = volumenMl(n); if (ml && !mapa.has(ml)) mapa.set(ml, false); }
  if (mapa.size < 2) return null;
  const partes = [...mapa.entries()].sort((a, b) => b[0] - a[0]).slice(0, 8)
    .map(([ml, hay]) => `${etiquetaVolumen(ml)} (${hay ? 'hay' : 'SIN stock'})`);
  return `Tamaños de esto en el catálogo: ${partes.join(' · ')}. Un tamaño "SIN stock" EXISTE y se vende en la casa: decí "de ese tamaño no tengo stock ahora", NUNCA "no lo tenemos" ni "el más grande es X".`;
}

/**
 * Lo que el cliente pide, renglón por renglón: cuánto y de qué.
 * "4 Malboro gold el blanco y dorado" son CUATRO atados (18/9/2026: el bot
 * cotizó uno y el cliente tuvo que pedirlo dos veces más). No se confunde con
 * la medida: "Coca de 2 litros 25" es un tamaño, no 25 unidades.
 */
const NUMERO_PALABRA: Record<string, number> = {
  un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8,
  nueve: 9, diez: 10, once: 11, doce: 12, docena: 12, quince: 15, veinte: 20, veinticuatro: 24,
};
const UNIDAD_MEDIDA = /^(l|lt|lts|litros?|cc|ml|k|kg|kilos?|g|gr|grs|gramos?|cm3|a|am|pm|hs?|horas?)$/;

export function cantidadesPedidas(texto: string | null | undefined): { cantidad: number; que: string }[] {
  const salida: { cantidad: number; que: string }[] = [];
  for (const cruda of String(texto ?? '').split(/[\n;]+/)) {
    const linea = cruda.trim();
    if (!linea || linea.length < 3) continue;
    let t = norm(linea);
    if (medidaPartida(t)) continue; // "coca de 2 litros 25": es tamaño, no cantidad
    // el pedido casi nunca empieza por el número: "puede ser 4 Malboro gold",
    // "necesito 2 fernet". Se saca la cortesía de adelante y queda el pedido.
    t = t.replace(/^(?:hola|buenas|buen dia|dale|ok|okey|okei|si|sii|por favor|porfa|pf|y|tambien|además|ademas|me|te|le)\b[\s,]*/g, '')
      .replace(/^(?:puede ser|podes ser|podrias|podes|necesito|necesitaria|quiero|querria|queria|dame|damelo|ponme|poneme|sumame|agregame|agrega|mandame|manda|traeme|trae|anotame|anota|llevo|llevame|va|van|ser[ií]an?|sumale|pedime|encargame)\b[\s,:]*/g, '')
      .trim();
    // "4 Malboro", "4 de malboro", "x4 malboro", "cuatro malboro"
    const m = t.match(/^(?:x\s*)?(\d{1,3}|[a-z]+)\s*(?:x|de|del)?\s+(.{3,60})$/);
    if (!m) continue;
    const bruto = m[1];
    const cantidad = /^\d+$/.test(bruto) ? Number(bruto) : NUMERO_PALABRA[bruto] ?? 0;
    if (!(cantidad >= 1 && cantidad <= 500)) continue;
    const resto = m[2].trim();
    if (UNIDAD_MEDIDA.test(resto.split(/\s+/)[0] ?? '')) continue; // "2 litros de coca" lo resuelve la medida
    salida.push({ cantidad, que: resto });
  }
  return salida;
}
