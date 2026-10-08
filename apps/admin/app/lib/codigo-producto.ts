// EL CÓDIGO PRIMERO (8/10/2026). Leandro: «necesito que el código de PLU salga
// primero siempre en la descripción», en el armado de pedidos y en la carga de
// facturas. El código es el PLU de la balanza; si no se cargó, el del sistema
// viejo (codigo_legacy), que es el mismo número; y si no viene ninguno, el del
// sku (L10578 → 10578, o 6668 tal cual).

type ConCodigo = { plu?: string | null; codigo_legacy?: string | null; sku?: string | null } | null | undefined;

const sinCeros = (s: string) => s.replace(/^0+(?=\d)/, '');

export function codigoPlu(p: ConCodigo): string | null {
  if (!p) return null;
  const directo = String(p.plu ?? '').trim() || String(p.codigo_legacy ?? '').trim();
  if (directo) return sinCeros(directo);
  const m = String(p.sku ?? '').trim().match(/^L?(\d+)$/i);
  return m ? sinCeros(m[1]) : null;
}

/** «10578 · Jamon Natural Rifka». Si no hay código, el nombre solo. */
export function conCodigo(nombre: string, p: ConCodigo): string {
  const c = codigoPlu(p);
  return c && !nombre.trim().startsWith(c) ? `${c} · ${nombre}` : nombre;
}
