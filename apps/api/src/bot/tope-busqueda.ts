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
//
// Revisión del 6/10/2026 (medida de nuevo sobre la base, ver el commit):
// - «empieza por lo pedido» mira también la categoría: buscando «cerveza», la
//   Brahma («Cervezas Lata») y la Quilmes quedaban 44ª y 45ª detrás de todo lo
//   que se llama «Cerveza …», y lo más vendido salía sin ficha.
// - singular y plural de las palabras terminadas en «e»: «espumante» no cubría
//   «Espumantes» (Baron B quedaba 40º), ni «chocolate» a «Chocolates».
// - las 2 más baratas de lo que mejor coincide van siempre con ficha: «¿cuál es
//   la cerveza más barata?» contestaba con la más barata de las 20 fichas y la
//   Quilmes a $1.990 estaba en el puesto 45, sin precio.
// Con estos cambios, en la base: «cerveza» → Brahma 2ª y Quilmes 3ª; «agua» →
// Villavicencio 2 L 3º, el x6 4º y el bidón 6º; «aperitivo» → Fernet Branca 2º;
// «espumante» → Baron B 2º. Recall con una sola palabra, N=10/15/20/25:
// 87,6/93,3/93,3/95,5 % (98,9 % entre fichas y nombres); con las palabras del
// cliente o el nombre corto, 100 % desde N=15: sigue N=20. Lo que perdió
// lugar son productos de poca venta de la misma categoría (fideos moños 18º →
// 28º, nombrado en `otros`). Las 2 baratas y la nota más larga suman ~4,5 %:
// 17 búsquedas comunes, 350.762 caracteres sin tope → 109.856 → 114.812.
// ============================================================
import { pideTamano, volumenMl } from './formatos';

/** Fichas por búsqueda cuando ODB_BOT_TOPE_BUSQUEDA no está cargada (medido el 6/10/2026). */
export const TOPE_BUSQUEDA_POR_DEFECTO = 20;
/** Si quedarían afuera 5 o menos, van todas: la nota y los nombres ocupan casi lo mismo. */
export const MARGEN_SIN_RECORTE = 5;
/** Nombres del resto que se listan (más allá, solo la cantidad). */
export const NOMBRES_DEL_RESTO = 40;
/** Las más baratas de lo que mejor coincide que van siempre con ficha, aunque pasen el tope. */
export const MAS_BARATAS = 2;

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

const sinE = (w: string) => w.replace(/e$/, '');
/**
 * La palabra buscada `w` coincide con la palabra `n` del nombre o la categoría:
 * igual, o desde 4 letras el comienzo («sere» → «serenisima»), o el singular y
 * el plural de las terminadas en «e» (6/10/2026: raiz deja «espumantes» en
 * «espumant» y «espumante» entero, y no se encontraban; con el comienzo solo,
 * «aceite» tampoco cubría «Aceites»). La «e» se iguala solo palabra contra
 * palabra: así «aceite» no cubre «aceitunas» ni «leche» «lechuga».
 */
function coincide(w: string, n: string): boolean {
  return n === w || (w.length >= 4 && n.startsWith(w)) || (w.length >= 5 && n.length >= 4 && sinE(n) === sinE(w));
}

/** «queso» cubre «Quesos»; «serenisima» cubre «Serenísima»; «espumante», «Espumantes». */
function cubre(w: string, tokens: string[]): boolean {
  return tokens.some((n) => coincide(w, n));
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
 * palabras, las que empiezan por la primera, en el nombre o en la categoría
 * («Leche La Serenísima» antes que «Dulce de leche La Serenísima»; la Brahma
 * de «Cervezas Lata» junto con las que se llaman «Cerveza …»); (5) las más
 * vendidas; (6) el orden en que vinieron. Además, las 2 más baratas de lo que
 * mejor coincide van con ficha aunque pasen el tope (para «lo más barato»).
 */
export function recortarBusqueda<T extends { sku?: string; nombre?: string; porDefecto?: boolean; precio?: number }>(
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
    const primerDeCat = deLaCategoria.find((x) => x) ?? '';
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
    // empieza por lo pedido el nombre o la categoría (6/10/2026, revisión: la
    // Brahma no se llama «Cerveza …» pero es de «Cervezas Lata»)
    const empieza = palabras.length > 0 && tiene === palabras.length && [primerToken, primerDeCat].some((t0) => !!t0 && coincide(primera, t0));
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
  const dentro = new Set(ranking.filter((x, k) => k < tope || x.fija));
  // LAS MÁS BARATAS (6/10/2026, revisión): las fichas se eligen por relevancia y
  // ventas, y del resto no viaja el precio. «¿Cuál es la cerveza más barata?»
  // salía con la más barata de las 20 fichas y la Quilmes a $1.990 quedaba 45ª.
  // Van con ficha las 2 más baratas de lo que mejor coincide (si pidió «cerveza
  // lata», de las latas; si hay de las que empiezan por lo pedido, de esas: en
  // «queso» las más baratas eran una empanada de jamón y queso y un arroz
  // preparado, medido en la base); quedan al final, en su lugar del orden.
  const precio = (x: { it: T }) => Number(x.it.precio);
  const maxTiene = Math.max(0, ...ranking.map((x) => x.tiene));
  const mejores = ranking.filter((x) => x.tiene === maxTiene);
  const grupo = mejores.some((x) => x.empieza) ? mejores.filter((x) => x.empieza) : mejores;
  grupo
    .filter((x) => Number.isFinite(precio(x)) && precio(x) > 0)
    .sort((a, b) => precio(a) - precio(b) || a.i - b.i)
    .slice(0, MAS_BARATAS)
    .forEach((x) => dentro.add(x));
  const visibles = ranking.filter((x) => dentro.has(x));
  const fuera = ranking.filter((x) => !dentro.has(x));
  if (!fuera.length) return { visibles: items, otros: null };
  const nombres = fuera.slice(0, NOMBRES_DEL_RESTO).map((x) => String(x.it.nombre ?? '')).join(' | ');
  const resto = fuera.length > NOMBRES_DEL_RESTO ? ` | +${fuera.length - NOMBRES_DEL_RESTO} más` : '';
  return {
    visibles: visibles.map((x) => x.it),
    otros: `Hay ${fuera.length} productos más con stock en esta búsqueda que no van con ficha; acá solo el nombre, sin precio: ${nombres}${resto}. Que no estén en items NO quiere decir que no los tengamos: si lo que pidió el cliente no está en items, buscá con más precisión (marca, tamaño, sabor) o por el nombre de esta lista para ver precio y presentación. Nunca digas que no hay algo sin buscarlo así. Las más baratas de lo que mejor coincide van con ficha; para lo más caro o un presupuesto, buscá con más precisión antes de comparar.`,
  };
}
