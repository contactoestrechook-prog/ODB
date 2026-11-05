// PARECIDOS (Leandro, 4/11/2026): «me dice que no tengo stock en puré de tomate
// La Campagnola, pero por ahí tengo puré de tomate Zika… no tengo azúcar por
// 500 gramos, pero por ahí tengo por un kilo». Antes de pedir algo hay que ver
// qué hay de lo mismo: otra marca, otro tamaño.
//
// El catálogo no tiene la marca cargada (45 de 10.800 productos) y las
// categorías están desprolijas (los purés de tomate viven en tres), así que la
// familia sale del NOMBRE: «Pure de tomate Marolio x 520gr» → cabeza «pure de
// tomate»; «Azucar Ledesma Light x 500g» → cabeza «azucar», resto «ledesma
// light». Dos productos con la misma cabeza son de la misma familia; si además
// tienen el mismo resto, son el mismo producto en otro tamaño.

const sinAcentos = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
export const normalizarNombre = (s: string) => sinAcentos(String(s ?? '').toLowerCase()).replace(/\s+/g, ' ').trim();

const UNIDAD = '(?:kgs?|kilos?|kl|k|grs?|gramos|g|mg|lts?|litros?|l|cc|cm3|ml|un|unid(?:ades)?|u|uds?|saquitos|sobres|capsulas|panos|hojas|mts?|m)';
// «x 500g», «1 kg», «x1.35L», «750cc», «x 12» …
const RE_TAMANO = new RegExp(`(?:\\bx\\s*)?\\b\\d+(?:[.,]\\d+)?\\s*${UNIDAD}\\b|\\bx\\s*\\d+(?:[.,]\\d+)?\\b`, 'g');
const RE_MEDIDA = /(\d+(?:[.,]\d+)?)\s*(kgs?|kilos?|kl|k|grs?|gramos|g|lts?|litros?|l|cc|cm3|ml)\b/;

// el envase no cambia qué producto es
const ENVASE = new Set(['bolsa', 'caja', 'estuche', 'lata', 'botella', 'tetra', 'frasco', 'pet', 'pack', 'doypack', 'dp', 'sachet', 'pouch', 'pote', 'vidrio', 'plastico', 'retornable', 'x', 'un', 'unidad']);
const VACIAS = new Set(['y', 'con', 'el', 'los', 'las', 'c', 's']);
// «pure DE tomate», «aceite DE oliva», «leche EN polvo», «alimento PARA perros»: la palabra que sigue es parte del tipo
const NEXO = new Set(['de', 'del', 'en', 'para', 'al', 'a', 'la']);
// las erratas que más se repiten en el catálogo
const ERRATAS: Record<string, string> = { ligth: 'light', ligt: 'light', premiun: 'premium', clasica: 'clasico', comun: 'comun' };

const singular = (t: string) => (t.length > 4 && t.endsWith('s') && !t.endsWith('ss') ? t.slice(0, -1) : t);

/** Las palabras que dicen qué producto es: sin tamaño, sin envase, sin relleno. */
export function palabrasDelNombre(nombre: string): string[] {
  const limpio = normalizarNombre(nombre).replace(RE_TAMANO, ' ').replace(/[^a-z0-9ñ ]/g, ' ');
  return limpio
    .split(' ')
    .filter((t) => t && !ENVASE.has(t) && !VACIAS.has(t) && !/^\d+$/.test(t))
    .map((t) => ERRATAS[t] ?? t);
}

/** La cabeza: el tipo de producto. La primera palabra y, si sigue un nexo, lo que une («pure de tomate»). */
export function cabezaDe(palabras: string[]): string[] {
  if (!palabras.length) return [];
  // un solo nexo: «pure de tomates DE LA Huerta» sigue siendo «pure de tomates»
  if (palabras.length >= 3 && NEXO.has(palabras[1])) return palabras.slice(0, 3);
  return [palabras[0]];
}

/** Lo que va después de la cabeza: marca y variedad, sin orden (para comparar). */
export const restoDe = (palabras: string[]) => palabras.slice(cabezaDe(palabras).length).map(singular).sort();

/** El tamaño que dice el nombre, en gramos o mililitros. null si no dice. */
export function tamanoDe(nombre: string): { cantidad: number; unidad: 'g' | 'ml'; texto: string } | null {
  const m = normalizarNombre(nombre).match(RE_MEDIDA);
  if (!m) return null;
  const v = Number(m[1].replace(',', '.'));
  if (!(v > 0)) return null;
  const u = m[2];
  const enGramos = u.startsWith('k') ? v * 1000 : u.startsWith('g') ? v : null;
  const cantidad = enGramos ?? (/^(l|lt|lts|litro|litros)$/.test(u) ? v * 1000 : v);
  const unidad = enGramos != null ? 'g' : 'ml';
  const texto = unidad === 'g'
    ? (cantidad >= 1000 ? `${String(cantidad / 1000).replace('.', ',')} kg` : `${cantidad} g`)
    : (cantidad >= 1000 ? `${String(cantidad / 1000).replace('.', ',')} L` : `${cantidad} ml`);
  return { cantidad, unidad, texto };
}

/** El prefijo con que se buscan los de la familia en el catálogo (nombre normalizado). */
export function prefijoDeFamilia(nombre: string): string {
  const cabeza = cabezaDe(palabrasDelNombre(nombre));
  if (!cabeza.length) return '';
  // la última palabra va en singular: «pure de tomate» también trae «pure de tomates …»
  return [...cabeza.slice(0, -1), singular(cabeza[cabeza.length - 1])].join(' ');
}

export type Relacion = 'otro_tamano' | 'parecido' | 'familia';

/**
 * Qué tan parecido es `otro` al producto `base`:
 * - otro_tamano: mismas palabras (marca y variedad), cambia el tamaño o el envase;
 * - parecido: comparten algo más que el tipo (la marca o la variedad);
 * - familia: solo el tipo.
 */
export function compararNombres(base: string, otro: string): { relacion: Relacion; coincidencias: number } {
  const a = restoDe(palabrasDelNombre(base));
  const b = restoDe(palabrasDelNombre(otro));
  const coincidencias = a.filter((t) => b.includes(t)).length;
  const iguales = a.length === b.length && coincidencias === a.length;
  return { relacion: iguales ? 'otro_tamano' : coincidencias > 0 ? 'parecido' : 'familia', coincidencias };
}

const ORDEN: Record<Relacion, number> = { otro_tamano: 0, parecido: 1, familia: 2 };

/** De más parecido a menos; a igual parecido, primero lo que tiene stock. */
export function ordenarParecidos<T extends { relacion: Relacion; coincidencias: number; stockTotal: number; nombre: string }>(items: T[]): T[] {
  return [...items].sort((x, y) =>
    ORDEN[x.relacion] - ORDEN[y.relacion]
    || y.coincidencias - x.coincidencias
    || y.stockTotal - x.stockTotal
    || x.nombre.localeCompare(y.nombre, 'es'));
}
