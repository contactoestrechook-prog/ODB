import Link from "next/link";
import { notFound } from "next/navigation";
import { apiJson } from "../../../lib/api";
import { pesos, descuentoPct, type Producto as P } from "../../../lib/tipos";
import { AgregarProducto } from "../../ui/AgregarProducto";
import { NotaCata } from "../../ui/NotaCata";
import { Producto } from "../../ui/Producto";
import { IcoLocal, IcoMoto, IcoTarjeta } from "../../ui/Iconos";
import { FotoProducto } from "../../ui/FotoProducto";
import { fotosCandidatas } from "../../../lib/fotos";
import { Titulo } from "../../ui/Titulo";

export const dynamic = "force-dynamic";

export default async function ProductoPage({ params }: { params: Promise<{ sku: string }> }) {
  const { sku } = await params;
  const p = await apiJson<P | null>(`/productos/${encodeURIComponent(sku)}`, null);
  if (!p || !p.nombre) notFound();
  const prod = p as P;
  const pct = descuentoPct(prod);

  const rel = prod.categoriaId
    ? await apiJson<{ items: P[] }>(`/productos?categoriaId=${prod.categoriaId}&porPagina=6`, { items: [] })
    : { items: [] };
  const relacionados = (rel.items ?? []).filter((x) => x.sku !== prod.sku).slice(0, 5);

  const ficha: [string, string][] = [];
  if (prod.marca) ficha.push(["Marca", prod.marca]);
  if (prod.categoria) ficha.push(["Categoría", prod.categoria]);
  if (prod.volumenMl) ficha.push(["Contenido", `${prod.volumenMl} ml`]);
  if (prod.graduacion) ficha.push(["Graduación", `${prod.graduacion}°`]);
  if (prod.unidadesPack && prod.unidadesPack > 1) ficha.push(["Presentación", `Pack × ${prod.unidadesPack}`]);

  return (
    <div className="max-w-6xl mx-auto px-5 lg:px-8 py-8">
      <nav className="text-xs text-humo mb-8 tracking-wide">
        <Link href="/" className="hover:text-rojo transition-colors">Inicio</Link>
        <span className="mx-2">·</span>
        <Link href="/catalogo" className="hover:text-rojo transition-colors">Catálogo</Link>
        {prod.categoria && <><span className="mx-2">·</span><span className="text-tinta/60">{prod.categoria}</span></>}
      </nav>

      <div className="grid md:grid-cols-2 gap-10 lg:gap-16">
        {/* imagen (sticky en desktop) */}
        <div className="md:sticky md:top-28 h-fit">
          <div className="relative overflow-hidden rounded-[22px] bg-white aspect-[4/5] ring-[10px] ring-crema">
            <FotoProducto imagenUrl={prod.imagenUrl} fotos={fotosCandidatas(prod.nombre, prod.sku)} logoH="h-16" />
            {pct != null && <span className="absolute top-4 left-4 bg-rojo text-white text-[12px] font-extrabold rounded-full px-3 py-1">−{pct}%</span>}
          </div>
        </div>

        {/* info */}
        <div className="md:py-2">
          {prod.marca && <p className="kicker text-dorado">{prod.marca}</p>}
          <h1 className="marca text-[32px] sm:text-[44px] font-extrabold text-ink mt-2 leading-[1] tracking-[-0.015em] [text-wrap:balance] [overflow-wrap:anywhere]">{prod.nombre}</h1>

          {prod.descuentoComunidad && (
            <span className="inline-block mt-4 bg-white text-rojo ring-1 ring-rojo/30 text-[12px] font-extrabold rounded-full px-3 py-1">Precio socio · Comunidad ODB</span>
          )}

          <div className="mt-6 flex items-end gap-3">
            <span className="marca text-[40px] font-extrabold text-ink leading-none">{pesos(prod.precio)}</span>
            {pct != null && <span className="text-lg text-humo line-through mb-1">{pesos(prod.precioLista)}</span>}
          </div>

          {prod.descripcion && <p className="mt-5 text-[15px] text-tinta/75 leading-relaxed max-w-md">{prod.descripcion}</p>}

          <div className="mt-7 max-w-md">
            <AgregarProducto p={prod} />
          </div>

          {ficha.length > 0 && (
            <dl className="mt-9 max-w-md divide-y divide-linea border-y border-linea">
              {ficha.map(([k, v]) => (
                <div key={k} className="flex justify-between py-3 text-sm">
                  <dt className="text-humo">{k}</dt>
                  <dd className="text-tinta font-medium">{v}</dd>
                </div>
              ))}
            </dl>
          )}

          <ul className="mt-8 space-y-3.5 text-sm text-tinta/75 max-w-md">
            <li className="flex items-center gap-3"><IcoMoto size={19} className="text-dorado shrink-0" /> Envío a domicilio desde Suc Sant Thomas</li>
            <li className="flex items-center gap-3"><IcoLocal size={19} className="text-dorado shrink-0" /> Retiro en el local (pick-up)</li>
            <li className="flex items-center gap-3"><IcoTarjeta size={19} className="text-dorado shrink-0" /> Pago seguro con Mercado Pago</li>
          </ul>
        </div>
      </div>

      {/* Nota del Somelier (solo bebidas con alcohol) */}
      <NotaCata sku={prod.sku} esAlcohol={prod.esAlcohol} />

      {/* Relacionados */}
      {relacionados.length > 0 && (
        <section className="mt-16">
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2 mb-6">
            <Titulo a="También" b="te puede gustar" className="text-[30px] sm:text-[38px] min-w-0" />
            {prod.categoriaId && <Link href={`/catalogo?categoriaId=${prod.categoriaId}`} className="shrink-0 text-[14px] font-bold text-rojo hover:text-rojo-osc transition-colors">Ver más →</Link>}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4">
            {relacionados.map((r) => <Producto key={r.sku} p={r} />)}
          </div>
        </section>
      )}
    </div>
  );
}
