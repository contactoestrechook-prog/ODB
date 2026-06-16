import Link from "next/link";
import { apiJson } from "../../lib/api";
import { Producto } from "../ui/Producto";
import { IcoBuscar } from "../ui/Iconos";
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
  qs.set("porPagina", "20");
  qs.set("pagina", String(pagina));

  const [filtros, data] = await Promise.all([
    apiJson<{ categorias: any[] }>("/catalogo/filtros", { categorias: [] }),
    apiJson<{ items: P[]; total: number; paginas: number }>(`/productos?${qs.toString()}`, { items: [], total: 0, paginas: 1 }),
  ]);
  const categorias = filtros.categorias ?? [];

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

  const kicker = filtro === "promo" ? "Por tiempo limitado" : "La tienda";
  const titulo = filtro === "promo" ? "Ofertas" : q ? "Resultados" : "Catálogo";

  return (
    <div className="max-w-7xl mx-auto px-5 lg:px-8 py-10">
      <header className="text-center max-w-2xl mx-auto">
        <p className="kicker text-dorado">{kicker}</p>
        <h1 className="display text-4xl sm:text-5xl font-semibold text-ink mt-2 tracking-tight">{titulo}</h1>
        {q && <p className="text-humo mt-2">Buscando “{q}”</p>}
      </header>

      <form action="/catalogo" className="mt-8 max-w-xl mx-auto">
        {filtro && <input type="hidden" name="filtro" value={filtro} />}
        <div className="flex items-center gap-3 border-b border-tinta/25 focus-within:border-dorado transition-colors pb-2.5">
          <IcoBuscar size={19} className="text-humo" />
          <input name="q" defaultValue={q} placeholder="Buscar vinos, fiambres, almacén…" className="flex-1 bg-transparent outline-none text-[15px] placeholder:text-humo/70" />
          <button className="text-sm font-semibold text-ink hover:text-rojo transition-colors">Buscar</button>
        </div>
      </form>

      <div className="mt-8 flex gap-2 overflow-x-auto sin-scroll pb-1 justify-start sm:justify-center">
        <Link href={chipHref("")} className={`shrink-0 rounded-full px-4 py-2 text-[13px] border transition-colors ${!categoriaId ? "bg-ink text-crema border-ink" : "border-linea text-tinta/80 hover:border-dorado"}`}>Todo</Link>
        {categorias.map((c: any) => (
          <Link key={c.id} href={chipHref(c.id)} className={`shrink-0 rounded-full px-4 py-2 text-[13px] border transition-colors ${categoriaId === c.id ? "bg-ink text-crema border-ink" : "border-linea text-tinta/80 hover:border-dorado"}`}>{c.nombre}</Link>
        ))}
      </div>

      <p className="text-center text-xs text-humo mt-6">{data.total.toLocaleString("es-AR")} productos</p>

      {data.items.length === 0 ? (
        <p className="text-center text-humo py-24">No encontramos productos. Probá con otra búsqueda.</p>
      ) : (
        <div className="mt-6 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-x-4 gap-y-9">
          {data.items.map((p) => <Producto key={p.sku} p={p} />)}
        </div>
      )}

      {data.paginas > 1 && (
        <div className="flex justify-center items-center gap-5 mt-14">
          {pagina > 1 ? <Link href={pageHref(pagina - 1)} className="text-sm font-medium text-tinta hover:text-rojo transition-colors">← Anterior</Link> : <span />}
          <span className="text-xs text-humo tracking-wide">{pagina} / {data.paginas}</span>
          {pagina < data.paginas ? <Link href={pageHref(pagina + 1)} className="text-sm font-medium text-tinta hover:text-rojo transition-colors">Siguiente →</Link> : <span />}
        </div>
      )}
    </div>
  );
}
