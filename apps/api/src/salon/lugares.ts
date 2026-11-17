// Los lugares del salón (17/11/2026). Cuánto del stock tiene su lugar cargado,
// por sucursal y por categoría. Al 17/11 había 5.197 productos con stock en
// Sant Thomas y 2.179 en Santa Inés, y ninguno con lugar: sin lugar, la lista
// de armado no sale en el orden del recorrido. Se carga por categoría (toda la
// góndola de Malbec de una) y después se afina producto por producto.

export type FilaStockLugar = {
  sucursal_id: string;
  cantidad: number | string | null;
  ubicacion: string | null;
  categoria_id: string | null;
};

export type ResumenLugares = {
  sucursales: { sucursalId: string; conStock: number; conLugar: number }[];
  /** De la sucursal pedida: categorías con productos con stock, las que más faltan primero. */
  categorias: { categoriaId: string | null; conStock: number; sinLugar: number }[];
  /** Los lugares que ya se usaron en esa sucursal (para no escribir «Gondola 3» y «Góndola 3»). */
  lugaresUsados: string[];
};

export const tieneLugar = (u: string | null | undefined) => !!String(u ?? '').trim();

/** Solo cuenta lo que tiene stock: lo que está en cero no hay que ir a buscarlo. */
export function resumirLugares(filas: FilaStockLugar[], sucursalId: string | null): ResumenLugares {
  const porSuc = new Map<string, { conStock: number; conLugar: number }>();
  const porCat = new Map<string | null, { conStock: number; sinLugar: number }>();
  const usados = new Map<string, number>();
  for (const f of filas) {
    const conStock = Number(f.cantidad) > 0;
    const lugar = tieneLugar(f.ubicacion);
    if (sucursalId && f.sucursal_id === sucursalId && lugar) {
      const l = String(f.ubicacion).trim();
      usados.set(l, (usados.get(l) ?? 0) + 1);
    }
    if (!conStock) continue;
    const s = porSuc.get(f.sucursal_id) ?? { conStock: 0, conLugar: 0 };
    s.conStock += 1;
    if (lugar) s.conLugar += 1;
    porSuc.set(f.sucursal_id, s);
    if (sucursalId && f.sucursal_id === sucursalId) {
      const c = porCat.get(f.categoria_id) ?? { conStock: 0, sinLugar: 0 };
      c.conStock += 1;
      if (!lugar) c.sinLugar += 1;
      porCat.set(f.categoria_id, c);
    }
  }
  return {
    sucursales: [...porSuc.entries()].map(([id, v]) => ({ sucursalId: id, ...v })).sort((a, b) => b.conStock - a.conStock),
    categorias: [...porCat.entries()]
      .map(([id, v]) => ({ categoriaId: id, ...v }))
      .sort((a, b) => b.sinLugar - a.sinLugar || b.conStock - a.conStock),
    lugaresUsados: [...usados.entries()]
      .sort((a, b) => a[0].localeCompare(b[0], 'es', { numeric: true }))
      .map(([l]) => l)
      .slice(0, 300),
  };
}
