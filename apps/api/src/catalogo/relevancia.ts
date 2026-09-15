// ============================================================
// RELEVANCIA DE LA BÚSQUEDA DE PRODUCTOS (2026-09-15)
//
// Con 11.000 productos, "contiene el texto" no alcanza: buscando
// "leche la sere" salían primero los "Dulce de Leche La Serenisima" —que
// también contienen esas palabras— y la leche de verdad quedaba fuera de la
// página. El cajero y quien carga facturas terminan vinculando el producto
// equivocado o dándolo de alta de nuevo.
//
// La regla es la que usaría una persona: gana el que EMPIEZA con lo que
// escribiste; después, el que tiene las palabras más al principio; y a igualdad,
// el nombre más corto (es el producto "base", no una variante).
// ============================================================

const sinTildes = (t: string) =>
  String(t ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

export type ProductoRankeable = { nombre?: string | null; sku?: string | null; activo?: boolean | null };

/** Puntaje de un producto para un término ya normalizado (sin tildes, minúsculas). */
export function puntajeRelevancia(nombre: string, termino: string, sku = ''): number {
  const n = sinTildes(nombre);
  const t = sinTildes(termino);
  if (!n || !t) return 0;
  const palabras = t.split(/\s+/).filter(Boolean);
  let puntos = 0;

  if (n === t) puntos += 1000;
  if (n.startsWith(t)) puntos += 400; // "leche la sere" → "Leche La Serenisima…"
  if (sinTildes(sku) === t) puntos += 800;

  for (const w of palabras) {
    const i = n.indexOf(w);
    if (i < 0) continue;
    puntos += 60;
    // palabra entera (no adentro de otra) y cuanto más al principio, mejor
    if (new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(n)) puntos += 40;
    puntos += Math.max(0, 40 - i);
  }

  // las palabras en el mismo orden que se escribieron valen más
  let desde = 0;
  let enOrden = true;
  for (const w of palabras) {
    const i = n.indexOf(w, desde);
    if (i < 0) { enOrden = false; break; }
    desde = i + w.length;
  }
  if (enOrden) puntos += 120;

  // a igualdad, el nombre más corto primero: es el producto base
  puntos -= Math.min(40, Math.floor(n.length / 4));
  return puntos;
}

/** Ordena por relevancia; los de baja quedan siempre al final. */
export function ordenarPorRelevancia<T extends ProductoRankeable>(items: T[], termino: string): T[] {
  return items
    .map((p, orden) => ({ p, orden, puntos: puntajeRelevancia(String(p.nombre ?? ''), termino, String(p.sku ?? '')) }))
    .sort((a, b) => {
      const activoA = a.p.activo === false ? 1 : 0;
      const activoB = b.p.activo === false ? 1 : 0;
      if (activoA !== activoB) return activoA - activoB;
      if (b.puntos !== a.puntos) return b.puntos - a.puntos;
      return a.orden - b.orden; // estable: mantiene el orden que vino de la base
    })
    .map((x) => x.p);
}
