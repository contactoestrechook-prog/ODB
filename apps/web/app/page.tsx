import Link from "next/link";
import { apiJson } from "../lib/api";
import { sesion } from "../lib/sesion";
import { Producto } from "./ui/Producto";
import { Hero } from "./ui/Hero";
import { IcoUva, IcoMoto, IcoMedalla, IcoFlecha, IcoLocal, IcoTarjeta } from "./ui/Iconos";
import type { Producto as P } from "../lib/tipos";

export const dynamic = "force-dynamic";

function Encabezado({ kicker, titulo, href }: { kicker: string; titulo: string; href?: string }) {
  return (
    <div className="flex items-end justify-between gap-4 mb-7">
      <div>
        <p className="kicker text-dorado">{kicker}</p>
        <h2 className="display text-3xl sm:text-[34px] font-semibold text-ink mt-1.5 tracking-tight">{titulo}</h2>
      </div>
      {href && (
        <Link href={href} className="shrink-0 inline-flex items-center gap-1.5 text-sm text-tinta/70 hover:text-rojo transition-colors group">
          Ver todo <IcoFlecha size={16} className="group-hover:translate-x-0.5 transition-transform" />
        </Link>
      )}
    </div>
  );
}

export default async function Home() {
  const cliente = await sesion();
  const [filtros, promo, destacados] = await Promise.all([
    apiJson<{ categorias: any[] }>("/catalogo/filtros", { categorias: [] }),
    apiJson<{ items: P[] }>("/productos?filtro=promo&porPagina=10", { items: [] }),
    apiJson<{ items: P[] }>("/productos?porPagina=10&orden=recientes", { items: [] }),
  ]);
  const categorias = (filtros.categorias ?? []).slice(0, 8);

  return (
    <div>
      {/* ───────── HERO (animado) ───────── */}
      <Hero nombre={cliente?.nombre ? cliente.nombre.split(" ")[0] : null} />

      {/* ───────── VALORES ───────── */}
      <section className="border-b border-linea bg-crema/40">
        <div className="max-w-7xl mx-auto px-5 lg:px-8 py-7 grid grid-cols-1 sm:grid-cols-3 gap-6 sm:gap-4 text-center">
          {[
            [<IcoUva key="u" size={22} />, "Curaduría", "Selección con criterio"],
            [<IcoMoto key="m" size={22} />, "Envío a domicilio", "Y retiro en el local"],
            [<IcoMedalla key="d" size={22} />, "Comunidad ODB", "Precios de socio y puntos"],
          ].map(([ico, t, s], i) => (
            <div key={i} className="flex items-center justify-center gap-3.5">
              <span className="text-dorado">{ico}</span>
              <div className="text-left">
                <p className="text-sm font-semibold text-ink">{t}</p>
                <p className="text-xs text-humo">{s}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="max-w-7xl mx-auto px-5 lg:px-8">
        {/* ───────── CATEGORÍAS ───────── */}
        {categorias.length > 0 && (
          <section className="mt-16">
            <Encabezado kicker="Explorá la bodega" titulo="Por categoría" href="/catalogo" />
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
              {categorias.map((c: any, i: number) => (
                <Link
                  key={c.id}
                  href={`/catalogo?categoriaId=${c.id}`}
                  className="group relative border border-linea hover:border-dorado/60 bg-crema rounded-[10px] p-5 transition-colors"
                >
                  <span className="display text-sm text-dorado/70">{String(i + 1).padStart(2, "0")}</span>
                  <p className="mt-6 text-[15px] font-semibold text-ink leading-snug">{c.nombre}</p>
                  <IcoFlecha size={16} className="mt-2 text-humo group-hover:text-rojo group-hover:translate-x-0.5 transition-all" />
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* ───────── OFERTAS ───────── */}
        {promo.items.length > 0 && (
          <section className="mt-20">
            <Encabezado kicker="Por tiempo limitado" titulo="Ofertas de la semana" href="/catalogo?filtro=promo" />
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-x-4 gap-y-9">
              {promo.items.map((p) => <Producto key={p.sku} p={p} />)}
            </div>
          </section>
        )}
      </div>

      {/* ───────── COMUNIDAD (banda) ───────── */}
      <section className="mt-20 bg-ink text-crema">
        <div className="max-w-7xl mx-auto px-5 lg:px-8 py-16 lg:py-20 grid lg:grid-cols-2 gap-10 items-center">
          <div>
            <p className="kicker text-dorado">Club de clientes</p>
            <h2 className="display text-3xl sm:text-5xl font-semibold mt-3 leading-[1.08] tracking-tight">
              Sumate a la <span className="italic text-dorado-claro">Comunidad ODB</span>
            </h2>
            <p className="mt-5 text-crema/55 max-w-md leading-relaxed">
              Verificá tu identidad una sola vez y desbloqueá una forma distinta de comprar.
            </p>
            <Link href={cliente ? "/cuenta" : "/ingresar"} className="inline-flex items-center gap-2 mt-8 bg-dorado text-ink rounded-full px-7 py-3.5 text-sm font-semibold hover:bg-dorado-claro transition-colors">
              {cliente ? "Verificar mi identidad" : "Crear mi cuenta"} <IcoFlecha size={16} />
            </Link>
          </div>
          <div className="grid sm:grid-cols-2 gap-px bg-crema/10 rounded-[10px] overflow-hidden">
            {[
              [<IcoTarjeta key="t" size={20} />, "Precios de socio", "Mejores precios en toda la tienda"],
              [<IcoMoto key="m" size={20} />, "Prioridad en envíos", "Tu pedido, primero"],
              [<IcoMedalla key="d" size={20} />, "Puntos en cada compra", "Canjealos por recompensas"],
              [<IcoUva key="u" size={20} />, "Selección exclusiva", "Etiquetas solo para socios"],
            ].map(([ico, t, s], i) => (
              <div key={i} className="bg-ink p-6">
                <span className="text-dorado">{ico}</span>
                <p className="mt-3 text-sm font-semibold text-crema">{t}</p>
                <p className="text-xs text-crema/45 mt-1 leading-relaxed">{s}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ───────── DESTACADOS ───────── */}
      {destacados.items.length > 0 && (
        <div className="max-w-7xl mx-auto px-5 lg:px-8">
          <section className="mt-20">
            <Encabezado kicker={cliente ? "Elegidos para vos" : "Recién llegados"} titulo={cliente ? "Recomendados" : "Novedades"} href="/catalogo" />
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-x-4 gap-y-9">
              {destacados.items.map((p) => <Producto key={p.sku} p={p} />)}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
