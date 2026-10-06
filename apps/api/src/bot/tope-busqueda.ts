// ============================================================
// TOPE DE LA BÚSQUEDA DEL BOT (Leandro, 6/10/2026: «sí, arreglalo»)
//
// La charla de Jimena (6/10, 8:25–8:39) costó USD 4,70 en 10 respuestas: el
// primer turno escribió 158.110 tokens de caché en 5 llamadas. buscar_productos
// devolvía TODO lo que coincidía, cada producto con su ficha completa («queso»
// 135 fichas, «tita» 101: toda la categoría galletitas), con una lista de 11
// productos eran ~10 búsquedas por turno, y cada vuelta del modelo volvía a
// escribir esos resultados en la caché.
//
// Ahora van con ficha (precio, presentación, medida) las ODB_BOT_TOPE_BUSQUEDA
// más relevantes (20 por defecto; 0 = sin tope) y del resto solo el nombre
// (hasta 40) y cuántos son, con una nota que le dice al modelo que hay más y
// que busque con más precisión. Medido el 6/10/2026 sobre 260 productos que el
// bot cotizó en los últimos 30 días, con la misma búsqueda reproducida en la
// base (scripts/medir-tope-busqueda.sql): con las palabras del cliente o el
// nombre corto del producto, el 100 % queda entre las 20 fichas; buscando con
// una sola palabra («queso», «agua», «fideos»), el 94 % (y el 100 % entre las
// fichas y los nombres). Con 15 eran 92 %; con 25, 95 %. Las 50 búsquedas más
// comunes de los clientes bajan de 510 mil a 215 mil caracteres (−58 %).
//
// El orden: lo que mejor coincide con la búsqueda primero, y entre parecidos lo
// más vendido. Nunca quedan afuera el producto por defecto (el más vendido de
// lo que pidió), el que tiene ese SKU o código, ni el que se llama igual que lo
// buscado (en el tamaño pedido, si lo pidió).
// ============================================================
import { pideTamano, volumenMl } from './formatos';

/** Fichas por búsqueda cuando ODB_BOT_TOPE_BUSQUEDA no está cargada (medido el 6/10/2026). */
export const TOPE_BUSQUEDA_POR_DEFECTO = 20;
/** Si quedarían afuera 5 o menos, van todas: la nota y los nombres ocupan casi lo mismo. */
export const MARGEN_SIN_RECORTE = 5;
/** Nombres del resto que se listan (más allá, solo la cantidad). */
export const NOMBRES_DEL_RESTO = 40;

/** El tope vigente: ODB_BOT_TOPE_BUSQUEDA (0 = sin tope); vacío o inválido, el de por defecto. */
export function topeDeBusqueda(valor: string | undefined = process.env.ODB_BOT_TOPE_BUSQUEDA): number {
  const t = String(valor ?? '').trim();
  if (!t) return TOPE_BUSQUEDA_POR_DEFECTO;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : TOPE_BUSQUEDA_POR_DEFECTO;
}

const norm = (t: unknown) => String(t ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const raiz = (w: string) => w.replace(/(es|s)$/, '');
// lo que no distingue un producto de otro: artículos, «pack», «precio», la unidad…
// («botella» y «lata» sí distinguen y se quedan)
const RELLENO = /^(de|del|la|las|el|los|en|con|sin|por|para|mas|menos|pack|packs|caja|cajas|unidad|unidades|grande|grandes|chico|chica|precio|precios|stock|opciones|tienen|hay|regalo|tipo|unos|unas|kilo|kilos|gramos|ltr|litro|litros)$/;

// cómo viene envasado: no cambia qué producto es («Queso Danbo La Serenísima x
// fracción» se llama igual que «queso danbo la serenísima»)
const PRESENTACION = /^(fraccion|fraccionado|fraccionada|botella|botellita|lata|sachet|tetra|pack|caja|estuche|bolsa|frasco|pote|doypack|porron|vidrio|pet|descartable|retornable|unidad|granel|suelto|suelta)$/;

/** Las palabras que cuentan para comparar (sin números, sin relleno, en su raíz y sin repetir). */
function palabrasClave(texto: unknown): string[] {
  const out: string[] = [];
  for (const w of norm(texto).split(/[^a-z0-9]+/)) {
    if (w.length < 3 || /\d/.test(w) || RELLENO.test(w)) continue;
    const r = raiz(w);
    if (!out.includes(r)) out.push(r);
  }
  return out;
}

/** «queso» cubre «Quesos»; «serenisima» cubre «Serenísima»; desde 4 letras vale el comienzo («sere»). */
function cubre(w: string, tokens: string[]): boolean {
  return tokens.some((n) => n === w || (w.length >= 4 && n.startsWith(w)));
}

export type RecorteDeBusqueda<T> = { visibles: T[]; otros: string | null };

/**
 * Deja con ficha las `tope` más relevantes de `items` y del resto arma un
 * renglón con los nombres. Con `tope` 0 (o si sobran 5 o menos) van todas, en el
 * orden de siempre.
 *
 * Orden: (1) las que nunca se recortan: la de por defecto, la del SKU o código
 * buscado (`exactos`) y la que se llama igual que la búsqueda; (2) las que
 * tienen más palabras de la búsqueda, en el nombre o en la categoría («agua»
 * es también el Villavicencio, que está en «Aguas Minerales» aunque su nombre
 * no lo diga); (3) las del tamaño pedido; (4) entre las que tienen todas las
 * palabras, las que empiezan por la primera («Leche La Serenísima» antes que
 * «Dulce de leche La Serenísima»); (5) las más vendidas; (6) el orden en que
 * vinieron.
 */
export function recortarBusqueda<T extends { sku?: string; nombre?: string; porDefecto?: boolean }>(
  items: T[],
  busqueda: string,
  vendidas: (sku: string) => number,
  tope: number,
  o: { exactos?: Set<string>; categoria?: (sku: string) => string | null | undefined } = {},
): RecorteDeBusqueda<T> {
  if (!(tope > 0) || items.length <= tope + MARGEN_SIN_RECORTE) return { visibles: items, otros: null };

  const palabras = palabrasClave(busqueda);
  const primera = palabras[0] ?? '';
  const tamano = pideTamano(busqueda);
  const skuBuscado = norm(busqueda).trim();

  const ranking = items.map((it, i) => {
    const nombre = String(it.nombre ?? '');
    const sku = String(it.sku ?? '');
    const tokens = norm(nombre).split(/[^a-z0-9]+/).map(raiz);
    const deLaCategoria = norm(o.categoria?.(sku) ?? '').split(/[^a-z0-9]+/).map(raiz);
    const ml = volumenMl(nombre);
    const enElNombre = palabras.filter((w) => cubre(w, tokens)).length;
    const tiene = palabras.filter((w) => cubre(w, tokens) || cubre(w, deLaCategoria)).length;
    // se llama igual que lo buscado: tiene todas las palabras y no le sobra
    // ninguna más que la presentación (y es del tamaño pedido, si lo pidió)
    const sobran = palabrasClave(nombre).filter((n) => !palabras.some((w) => cubre(w, [n])) && !PRESENTACION.test(n));
    const mismoNombre = palabras.length > 0 && enElNombre === palabras.length && !sobran.length && (!tamano?.ml || ml === tamano.ml);
    const fija = !!it.porDefecto || mismoNombre || (!!sku && (!!o.exactos?.has(sku) || norm(sku) === skuBuscado));
    const talle = !!tamano && (tamano.ml ? ml === tamano.ml : (ml ?? 0) > 1000);
    const primerToken = tokens.find((x) => x) ?? '';
    const empieza = palabras.length > 0 && tiene === palabras.length && (primerToken === primera || (primera.length >= 4 && primerToken.startsWith(primera)));
    return { it, i, fija, tiene, talle, empieza, vendidas: Number(vendidas(sku)) || 0 };
  });
  ranking.sort((a, b) =>
    Number(b.fija) - Number(a.fija)
    || b.tiene - a.tiene
    || Number(b.talle) - Number(a.talle)
    || Number(b.empieza) - Number(a.empieza)
    || b.vendidas - a.vendidas
    || a.i - b.i);

  // las fijas nunca quedan afuera, aunque fueran más que el tope
  const visibles = ranking.filter((x, k) => k < tope || x.fija);
  const fuera = ranking.filter((x, k) => !(k < tope || x.fija));
  if (!fuera.length) return { visibles: items, otros: null };
  const nombres = fuera.slice(0, NOMBRES_DEL_RESTO).map((x) => String(x.it.nombre ?? '')).join(' | ');
  const resto = fuera.length > NOMBRES_DEL_RESTO ? ` | +${fuera.length - NOMBRES_DEL_RESTO} más` : '';
  return {
    visibles: visibles.map((x) => x.it),
    otros: `Hay ${fuera.length} productos más con stock en esta búsqueda que no van con ficha; acá solo el nombre, sin precio: ${nombres}${resto}. Que no estén en items NO quiere decir que no los tengamos: si lo que pidió el cliente no está en items, buscá con más precisión (marca, tamaño, sabor) o por el nombre de esta lista para ver precio y presentación. Nunca digas que no hay algo sin buscarlo así.`,
  };
}
