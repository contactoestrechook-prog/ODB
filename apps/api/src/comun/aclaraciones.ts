// LA ACLARACIÓN DE UN RENGLÓN (Leandro, 20/11/2026, simulacro: «el desodorante
// Saphirus en el pedido me aclaran que es sabor a limón y cuando le llega a la
// persona para armar el pedido no le figura la aclaración del sabor»).
//
// Hay productos cargados como uno solo para todas sus variantes («Aromatizante
// Saphirus Textil VARIOS»): el cliente pide «Saphirus limón», el bot lo anota
// bien en su lista, pero el pedido guardaba solo el SKU y la cantidad y el
// «limón» se perdía. Ahora la aclaración viaja en las notas del pedido, con una
// forma fija que se puede volver a leer por renglón:
//
//   Aclaraciones: Aromatizante Saphirus Textil VARIOS «limón»; Otro producto «rojo»
//
// La misma forma la lee el panel (apps/admin/app/lib/aclaraciones.ts, copia).

export type Aclaracion = { nombre: string; texto: string };

const PREFIJO = 'Aclaraciones:';
const limpiar = (s: unknown) => String(s ?? '').replace(/[«»;·]/g, ' ').replace(/\s+/g, ' ').trim();

/** Las aclaraciones que mandó el modelo, por SKU (la primera no vacía de cada uno). */
export function aclaracionesPorSku(items: unknown): Map<string, string> {
  const m = new Map<string, string>();
  for (const it of (Array.isArray(items) ? items : []) as any[]) {
    const sku = String(it?.sku ?? '').trim();
    const texto = limpiar(it?.aclaracion).slice(0, 60);
    if (sku && texto && !m.has(sku)) m.set(sku, texto);
  }
  return m;
}

/** Las notas sin el tramo de aclaraciones (para no repetirlo ni mostrárselo dos veces al cliente). */
export function sinAclaraciones(notas: unknown): string {
  return String(notas ?? '')
    .split(/\s*·\s*/)
    .filter((t) => t && !t.trim().startsWith(PREFIJO))
    .join(' · ')
    .trim();
}

/** Notas para guardar: primero las aclaraciones (las notas se cortan a 300), después lo demás. */
export function notasConAclaraciones(notas: unknown, aclaraciones: Aclaracion[]): string {
  const resto = sinAclaraciones(notas);
  const tramo = aclaraciones.length
    ? `${PREFIJO} ${aclaraciones.map((a) => `${limpiar(a.nombre)} «${limpiar(a.texto)}»`).join('; ')}`
    : '';
  return [tramo, resto].filter(Boolean).join(' · ');
}

/** Lee las aclaraciones de las notas de un pedido. */
export function aclaracionesDeNotas(notas: unknown): Aclaracion[] {
  const tramo = String(notas ?? '').split(/\s*·\s*/).find((t) => t.trim().startsWith(PREFIJO));
  if (!tramo) return [];
  return [...tramo.slice(tramo.indexOf(PREFIJO) + PREFIJO.length).matchAll(/([^;«]+?)\s*«([^»]+)»/g)]
    .map((m) => ({ nombre: m[1].replace(/^[\s;]+/, '').trim(), texto: m[2].trim() }))
    .filter((a) => a.nombre && a.texto);
}

/**
 * Cambia (o agrega) la aclaración de UN producto en las notas de un pedido y deja
 * lo demás como estaba (20/11/2026: el cliente eligió otra fragancia porque no
 * había la que pidió). El tramo de aclaraciones queda en el mismo lugar.
 */
export function cambiarAclaracion(notas: unknown, nombre: string, texto: string): string {
  const actuales = aclaracionesDeNotas(notas);
  const n = limpiar(nombre).toLowerCase();
  const nuevas = actuales.some((a) => limpiar(a.nombre).toLowerCase() === n)
    ? actuales.map((a) => (limpiar(a.nombre).toLowerCase() === n ? { nombre: a.nombre, texto } : a))
    : [...actuales, { nombre, texto }];
  const tramo = `${PREFIJO} ${nuevas.map((a) => `${limpiar(a.nombre)} «${limpiar(a.texto)}»`).join('; ')}`;
  const partes = String(notas ?? '').split(/\s*·\s*/).filter(Boolean);
  const i = partes.findIndex((t) => t.trim().startsWith(PREFIJO));
  if (i >= 0) partes[i] = tramo; else partes.unshift(tramo);
  return partes.join(' · ');
}

/** La aclaración de un producto del pedido, por su nombre (sin importar mayúsculas ni espacios). */
export function aclaracionDe(nombre: string, aclaraciones: Aclaracion[]): string | null {
  const n = limpiar(nombre).toLowerCase();
  return aclaraciones.find((a) => limpiar(a.nombre).toLowerCase() === n)?.texto ?? null;
}
