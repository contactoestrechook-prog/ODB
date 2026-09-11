// Lo que el asistente de compras le devuelve a la tienda, armado y controlado
// en código. El modelo propone grupos de SKUs; acá se descarta todo lo que no
// salió de una búsqueda real de esta charla (nunca un producto inventado), se
// sacan repetidos y se ponen topes para que la pantalla no se llene de fotos:
// Leandro pidió una compra guiada, no una góndola infinita.

export const MAX_GRUPOS = 4;
export const MAX_POR_GRUPO = 6;
export const MAX_SUGERENCIAS = 4;

export type PropuestaModelo = {
  mensaje?: string;
  grupos?: { titulo?: string; skus?: string[] }[];
  sugerencias?: string[];
};

export type Grupo<P> = { titulo: string; items: P[] };

export function armarRespuesta<P extends { sku: string }>(
  propuesta: PropuestaModelo,
  vistos: Map<string, P>,
): { mensaje: string; grupos: Grupo<P>[]; sugerencias: string[] } {
  const usados = new Set<string>();
  const grupos: Grupo<P>[] = [];
  for (const g of propuesta.grupos ?? []) {
    if (grupos.length >= MAX_GRUPOS) break;
    const items: P[] = [];
    for (const sku of g.skus ?? []) {
      const p = vistos.get(String(sku));
      if (!p || usados.has(p.sku)) continue; // inventado o repetido: afuera
      usados.add(p.sku);
      items.push(p);
      if (items.length >= MAX_POR_GRUPO) break;
    }
    const titulo = String(g.titulo ?? '').trim().slice(0, 60);
    if (items.length) grupos.push({ titulo: titulo || 'Para vos', items });
  }
  const sugerencias = [...new Set((propuesta.sugerencias ?? []).map((s) => String(s).trim()).filter((s) => s.length >= 2 && s.length <= 48))].slice(0, MAX_SUGERENCIAS);
  return { mensaje: String(propuesta.mensaje ?? '').trim(), grupos, sugerencias };
}

// Si el modelo terminó sin llamar a `responder`, igual se muestra lo que buscó:
// un grupo con lo primero de cada búsqueda, en el orden en que buscó.
export function grupoDeRespaldo<P extends { sku: string }>(busquedas: { q: string; skus: string[] }[], vistos: Map<string, P>): Grupo<P>[] {
  return busquedas
    .map((b) => ({ titulo: b.q.charAt(0).toUpperCase() + b.q.slice(1), items: b.skus.map((s) => vistos.get(s)).filter(Boolean).slice(0, MAX_POR_GRUPO) as P[] }))
    .filter((g) => g.items.length)
    .slice(0, MAX_GRUPOS);
}
