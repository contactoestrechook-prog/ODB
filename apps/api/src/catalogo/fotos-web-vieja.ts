// Fotos del sitio viejo de ODB, www.odbpremiummarket.com.ar (Leandro, 6/10/2026:
// «tiene el sitio publicado viejo de ODB con muchas imágenes de producto que
// nos sirven»). Ese sitio se armó con los códigos del sistema viejo: su SKU es
// nuestro codigo_legacy (sku 1461 = "Andes IPA 473", L1461). Solo se aceptan
// imágenes de su servidor de imágenes: el API descarga la URL, nunca una cualquiera.

const HOSTS = /^cdn\.plantheoshops\.com\.ar$/i;

/** La URL original de la foto, o null si no es una imagen del sitio viejo o es la de "sin imagen". */
export function urlFotoWebVieja(u: unknown): string | null {
  const s = String(u ?? '').trim();
  if (!s) return null;
  let url: URL;
  try { url = new URL(s.startsWith('//') ? `https:${s}` : s); } catch { return null; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (!HOSTS.test(url.hostname)) return null;
  if (!/^\/imagenes\//i.test(url.pathname)) return null;
  if (/sin[-_]?imagen|no[-_]?image|no[-_]?photo|placeholder/i.test(url.pathname)) return null;
  if (!/\.(jpe?g|png|webp)$/i.test(url.pathname)) return null;
  url.protocol = 'https:';
  return url.toString();
}

export type ItemWebVieja = { sku: string; url: string; nombre?: string | null };

/** Valida y limpia un lote: SKU de ODB, URL del sitio viejo, sin repetidos. */
export function loteWebVieja(items: unknown, max = 100): { validos: ItemWebVieja[]; descartados: number } {
  const lista = Array.isArray(items) ? items : [];
  const vistos = new Set<string>();
  const validos: ItemWebVieja[] = [];
  let descartados = 0;
  for (const it of lista.slice(0, max)) {
    const sku = String((it as any)?.sku ?? '').trim();
    const url = urlFotoWebVieja((it as any)?.url);
    if (!sku || !url || vistos.has(sku)) { descartados++; continue; }
    vistos.add(sku);
    validos.push({ sku, url, nombre: (it as any)?.nombre ? String((it as any).nombre).slice(0, 200) : null });
  }
  return { validos, descartados: descartados + Math.max(0, lista.length - max) };
}
