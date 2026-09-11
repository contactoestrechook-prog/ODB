import Link from "next/link";
import { apiJson } from "../../lib/api";
import { Producto } from "../ui/Producto";
import { Titulo } from "../ui/Titulo";
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
  qs.set("porPagina", "25");
  // La góndola abre con lo que tiene foto: en orden alfabético arrancaba con
  // vasos y huevos sueltos sin imagen, que es la peor primera pantalla posible.
  if (!sp.orden) qs.set("orden", "foto");
  qs.set("pagina", String(pagina));

  const [filtros, data] = await Promise.all([
    apiJson<{ categorias: any[] }>("/catalogo/filtros", { categorias: [] }),
    apiJson<{ items: P[]; total: number; paginas: number }>(`/productos?${qs.toString()}`, { items: [], total: 0, paginas: 1 }),
  ]);
  const categorias = filtros.categorias ?? [];
  const categoriaActual = categorias.find((c: any) => c.id === categoriaId)?.nombre as string | undefined;

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

  // La primera fila va en grande: son las que abren la góndola y tienen foto.
  const destacados = pagina === 1 && !q ? data.items.slice(0, 4) : [];
  const resto = data.items.slice(destacados.length);

  // Título en dos colores según dónde estás parado
  const [a, b] =
    filtro === "promo" ? ["Ofertas", "de la semana"]
    : q ? ["Resultados para", `“${q}”`]
    : categoriaActual ? ["Todo en", categoriaActual.toLowerCase()]
    : ["Toda", "la tienda"];

  const chip = (activo: boolean) =>
    `shrink-0 rounded-full h-10 px-4 inline-flex items-center text-[13px] font-bold border-2 transition-colors ${
      activo ? "bg-ink text-white border-ink" : "border-ink/15 text-ink hover:border-ink"
    }`;

  return (
    <div className="max-w-7xl mx-auto px-5 lg:px-8 pt-8 pb-6">
      <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
        <div className="min-w-0">
          <Titulo como="h1" a={a} b={b} className="text-[36px] sm:text-[52px] [overflow-wrap:anywhere]" />
          <p className="mt-2 text-[14px] font-semibold text-humo">{data.total.toLocaleString("es-AR")} productos</p>
        </div>
        <form action="/catalogo" className="w-full sm:w-auto sm:min-w-[380px] flex items-center gap-2.5 rounded-full border-2 border-ink pl-4 pr-1.5 h-12 focus-within:border-rojo transition-colors">
          {filtro && <input type="hidden" name="filtro" value={filtro} />}
          <IcoBuscar size={18} className="text-humo shrink-0" />
          <input name="q" defaultValue={q} placeholder="Buscar vinos, fiambres, almacén…" className="min-w-0 flex-1 bg-transparent outline-none text-[14px] placeholder:text-humo" />
          <button className="shrink-0 rounded-full bg-rojo text-white h-9 px-4 text-[13px] font-bold hover:bg-rojo-osc transition-colors">Buscar</button>
        </form>
      </header>

      <div className="mt-6 -mx-5 px-5 lg:mx-0 lg:px-0 flex gap-2 overflow-x-auto sin-scroll pb-1">
        <Link href={chipHref("")} className={chip(!categoriaId)}>Todo</Link>
        {categorias.map((c: any) => (
          <Link key={c.id} href={chipHref(c.id)} className={`${chip(categoriaId === c.id)} capitalize`}>{String(c.nombre).toLowerCase()}</Link>
        ))}
      </div>

      {data.items.length === 0 ? (
        <div className="mt-10 rounded-[22px] bg-crema px-8 py-14 text-center">
          <Titulo a="No encontramos" b="nada con eso" className="text-[28px] sm:text-[34px]" />
          <p className="mt-3 text-humo">Probá con otra palabra, o con la marca o el varietal: “malbec”, “Salentein”, “fernet”.</p>
        </div>
      ) : (
        <>
          {destacados.length > 0 && (
            <div className="mt-6 grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
              {destacados.map((p) => <Producto key={p.sku} p={p} grande />)}
            </div>
          )}
          <div className={`${destacados.length ? "mt-3 sm:mt-4" : "mt-6"} grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4`}>
            {resto.map((p) => <Producto key={p.sku} p={p} />)}
          </div>
        </>
      )}

      {data.paginas > 1 && (
        <nav className="flex justify-center items-center gap-3 mt-12" aria-label="Páginas">
          {pagina > 1 ? <Link href={pageHref(pagina - 1)} className="rounded-full border-2 border-ink h-11 px-5 inline-flex items-center text-[14px] font-bold text-ink hover:bg-ink hover:text-white transition-colors">← Anterior</Link> : <span />}
          <span className="text-[13px] font-semibold text-humo tabular-nums">Página {pagina} de {data.paginas}</span>
          {pagina < data.paginas ? <Link href={pageHref(pagina + 1)} className="rounded-full bg-ink h-11 px-5 inline-flex items-center text-[14px] font-bold text-white hover:bg-rojo transition-colors">Siguiente →</Link> : <span />}
        </nav>
      )}
    </div>
  );
}
