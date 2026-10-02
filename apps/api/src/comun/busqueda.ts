// Una sola regla de búsqueda para todo el sistema (2/10/2026: "café cabrales"
// no encontraba nada en el agente de compras porque el catálogo dice "Cafe").
//   1. todas las palabras, en cualquier orden, sin importar tildes ni
//      mayúsculas, plurales a su raíz ("cafés" → "caf"), números sin unidad
//      ("x250grs" → "250") y sin palabras vacías ("de", "x", "gr");
//   2. si así no aparece nada: errores de tipeo ("cabrlaes", "coca zreo").
// Es la misma regla que palabras_de_busqueda()/terminos_busqueda()/
// palabra_parecida() en la base (db/migracion-busqueda.sql) y que
// apps/admin/app/lib/busqueda.ts: si se toca una, se tocan las tres.
// En la base hay además un tercer nivel (una palabra de menos) dentro de
// buscar_productos().

const VACIAS = new Set([
  'de', 'del', 'la', 'las', 'el', 'los', 'lo', 'y', 'e', 'o', 'u', 'con', 'para', 'en', 'por', 'al',
  'un', 'una', 'unos', 'unas', 'x', 'g', 'gr', 'grs', 'gramo', 'gramos', 'kg', 'kgs', 'kilo', 'kilos',
  'ml', 'cc', 'l', 'lt', 'lts', 'litro', 'litros', 'cm', 'mm', 'unid', 'unidad', 'unidades', 'ud', 'uds',
]);

/** Minúsculas y sin tildes (como quitar_tildes() en la base). */
export function normalizarTexto(s: unknown): string {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/** Las palabras de una búsqueda: como se escribieron (sin tildes) y su raíz. */
export function palabrasDeBusqueda(q: unknown): { cruda: string; raiz: string }[] {
  return normalizarTexto(q)
    .split(/[^a-z0-9]+/)
    .filter((w) => w && (/[0-9]/.test(w) || w.length >= 2) && !VACIAS.has(w))
    .map((w) => ({
      cruda: w,
      raiz: /[0-9]/.test(w)
        ? (w.match(/[0-9]+/)?.[0] ?? w)
        : w.length > 4 && w.endsWith('es')
          ? w.slice(0, -2)
          : w.length > 3 && w.endsWith('s')
            ? w.slice(0, -1)
            : w,
    }));
}

/** Las raíces sin repetir. Si todo eran palabras vacías ("de", "x"), la búsqueda tal cual. */
export function terminosDeBusqueda(q: unknown): string[] {
  const raices = [...new Set(palabrasDeBusqueda(q).map((p) => p.raiz).filter(Boolean))].sort();
  if (raices.length) return raices;
  const tal = normalizarTexto(q).trim();
  return tal ? [tal] : [];
}

/** ¿El texto tiene TODAS las palabras de la búsqueda? */
export function coincideBusqueda(texto: unknown, q: unknown): boolean {
  const terminos = terminosDeBusqueda(q);
  if (!terminos.length) return true;
  const t = normalizarTexto(texto);
  return terminos.every((w) => t.includes(w));
}

function distancia(a: string, b: string, tope: number): number {
  if (Math.abs(a.length - b.length) > tope) return tope + 1;
  let previa = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const fila = [i];
    let minimo = i;
    for (let j = 1; j <= b.length; j++) {
      fila[j] = Math.min(previa[j] + 1, fila[j - 1] + 1, previa[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (fila[j] < minimo) minimo = fila[j];
    }
    if (minimo > tope) return tope + 1;
    previa = fila;
  }
  return Math.min(previa[b.length], tope + 1);
}

const ordenadas = (s: string) => [...s].sort().join('');

/**
 * ¿La palabra w (del producto, proveedor…) se parece a la buscada r (cruda)?
 * Vale la palabra entera o su comienzo: una letra de diferencia hasta 6
 * letras, dos desde 7, y dos letras dadas vuelta en cualquier largo.
 */
export function palabraParecida(r: string, w: string): boolean {
  if (w.length < r.length - 2) return false;
  const tope = r.length >= 7 ? 2 : 1;
  if (distancia(r, w, 2) <= tope) return true;
  const comienzo = w.slice(0, r.length);
  const d = distancia(r, comienzo, 2);
  if (d <= tope) return true;
  return d === 2 && ordenadas(r) === ordenadas(comienzo);
}

/** Como coincideBusqueda, pero tolera errores de tipeo en las palabras de 4 letras o más. */
export function coincideAproximado(texto: unknown, q: unknown): boolean {
  const palabras = palabrasDeBusqueda(q).filter((p) => !/^[0-9]+$/.test(p.raiz));
  if (!palabras.length) return false;
  const t = normalizarTexto(texto);
  const vocabulario = t.split(/[^a-z0-9]+/).filter(Boolean);
  return palabras.every(
    (p) => t.includes(p.raiz) || (p.cruda.length >= 4 && vocabulario.some((w) => palabraParecida(p.cruda, w))),
  );
}

/**
 * Filtra una lista en memoria: primero con todas las palabras; si no queda
 * nada, con errores de tipeo. Sin búsqueda devuelve la lista entera.
 */
export function filtrarPorBusqueda<T>(items: T[], q: unknown, textoDe: (x: T) => unknown): T[] {
  if (!terminosDeBusqueda(q).length) return items;
  const exactos = items.filter((x) => coincideBusqueda(textoDe(x), q));
  if (exactos.length) return exactos;
  return items.filter((x) => coincideAproximado(textoDe(x), q));
}

/**
 * Agrega a una consulta de Supabase un filtro por palabra sobre una columna ya
 * normalizada (texto_busqueda de productos, clientes y proveedores). Las
 * raíces solo tienen letras y números: no hace falta escapar nada.
 */
export function filtrarColumna<Q extends { like: (columna: string, patron: string) => Q }>(
  query: Q,
  columna: string,
  q: unknown,
  maximo = 6,
): Q {
  for (const t of terminosDeBusqueda(q).slice(0, maximo)) query = query.like(columna, `%${t}%`);
  return query;
}
