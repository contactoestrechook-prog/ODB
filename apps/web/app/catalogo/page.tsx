import Link from "next/link";
import { apiJson } from "../../lib/api";
import { Producto } from "../ui/Producto";
import type { Producto as P } from "../../lib/tipos";

export const dynamic = "force-dynamic";

type SP = Record<string, string | undefined>;

export default async function Catalogo({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const q = sp.q ?? "";
  const categoriaId = sp.categoriaId ?? "";
  const filtro = sp.filtro ?? "";
  const pagina = Math.max(1, Number(sp.pagina ?? 1) || 1);

  const qs = new URLSearchParams();
  if (q) qs.set("buscar", q);
  if (categoriaId) qs.set("categoriaId", categoriaId);
  if (filtro) qs.set("filtro", filtro);
  qs.set("porPagina", "24");
  qs.set("pagina", String(pagina));

  const [filtros, data] = await Promise.all([
    apiJson<{ categorias: any[] }>("/catalogo/filtros", { categorias: [] }),
    apiJson<{ items: P[]; total: number; paginas: number }>(`/productos?${qs.toString()}`, { items: [], total: 0, paginas: 1 }),
  ]);
  const categorias = filtros.categorias ?? [];

  // helper para armar links de chip preservando búsqueda/filtro
  const chipHref = (cat: string) => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (filtro) p.set("filtro", filtro);
    if (cat) p.set("categoriaId", cat);
    return `/catalogo${p.toString() ? "?" + p.toString() : ""}`;
  };
  const pageHref = (n: number) => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (categoriaId) p.set("categoriaId", categoriaId);
    if (filtro) p.set("filtro", filtro);
    p.set("pagina", String(n));
    return `/catalogo?${p.toString()}`;
  };

  const titulo = filtro === "promo" ? "Ofertas" : q ? `Resultados para “${q}”` : "Catálogo";

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      {/* buscador */}
      <form action="/catalogo" className="mb-5">
        {filtro && <input type="hidden" name="filtro" value={filtro} />}
        <div className="flex items-center gap-2 bg-white rounded-full px-4 py-3 border border-black/10 max-w-2xl">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-[#9B9088]"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" /></svg>
          <input name="q" defaultValue={q} placeholder="Buscar vinos, fiambres, almacén…" className="flex-1 text-sm outline-none bg-transparent text-[#2A201C]" />
          <button className="bg-[#B82D25] text-white text-sm font-medium rounded-full px-4 py-1.5 hover:bg-[#932A1F]">Buscar</button>
        </div>
      </form>

      {/* chips de categoría */}
      <div className="flex gap-2 overflow-x-auto sin-scroll pb-3 mb-5">
        <Link href={chipHref("")} className={`shrink-0 rounded-full px-4 py-2 text-sm font-medium border ${!categoriaId ? "bg-[#B82D25] text-white border-[#B82D25]" : "bg-white text-[#2A201C] border-black/10 hover:border-[#B82D25]"}`}>Todo</Link>
        {categorias.map((c: any) => (
          <Link key={c.id} href={chipHref(c.id)} className={`shrink-0 rounded-full px-4 py-2 text-sm font-medium border ${categoriaId === c.id ? "bg-[#B82D25] text-white border-[#B82D25]" : "bg-white text-[#2A201C] border-black/10 hover:border-[#B82D25]"}`}>{c.nombre}</Link>
        ))}
      </div>

      <div className="flex items-baseline justify-between mb-4">
        <h1 className="text-xl font-bold text-[#2A201C]">{titulo}</h1>
        <p className="text-sm text-[#9B9088]">{data.total} productos</p>
      </div>

      {data.items.length === 0 ? (
        <p className="bg-white rounded-2xl p-12 text-center text-[#9B9088]">No encontramos productos. Probá con otra búsqueda.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4">
          {data.items.map((p) => <Producto key={p.sku} p={p} />)}
        </div>
      )}

      {/* paginado */}
      {data.paginas > 1 && (
        <div className="flex justify-center items-center gap-3 mt-8">
          {pagina > 1 && <Link href={pageHref(pagina - 1)} className="rounded-full bg-white border border-black/10 px-4 py-2 text-sm hover:border-[#B82D25]">← Anterior</Link>}
          <span className="text-sm text-[#9B9088]">Página {pagina} de {data.paginas}</span>
          {pagina < data.paginas && <Link href={pageHref(pagina + 1)} className="rounded-full bg-white border border-black/10 px-4 py-2 text-sm hover:border-[#B82D25]">Siguiente →</Link>}
        </div>
      )}
    </div>
  );
}
