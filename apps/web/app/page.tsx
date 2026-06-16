import Link from "next/link";
import { apiJson } from "../lib/api";
import { sesion } from "../lib/sesion";
import { Producto } from "./ui/Producto";
import type { Producto as P } from "../lib/tipos";

export const dynamic = "force-dynamic";

const EMOJI: Record<string, string> = {
  vinos: "🍷", vino: "🍷", cervezas: "🍺", cerveza: "🍺", bebidas: "🥤", aguas: "💧",
  fiambres: "🧀", fiambre: "🧀", quesos: "🧀", almacen: "🛒", almacén: "🛒",
  aceites: "🫒", tabaco: "🚬", pescaderia: "🐟", pescadería: "🐟", limpieza: "🧼",
  golosinas: "🍫", snacks: "🥨", lacteos: "🥛", lácteos: "🥛",
};
const emojiCat = (n: string) => EMOJI[(n ?? "").toLowerCase().trim()] ?? "🛍️";

export default async function Home() {
  const cliente = await sesion();
  const [filtros, promo, destacados] = await Promise.all([
    apiJson<{ categorias: any[] }>("/catalogo/filtros", { categorias: [] }),
    apiJson<{ items: P[] }>("/productos?filtro=promo&porPagina=12", { items: [] }),
    apiJson<{ items: P[] }>("/productos?porPagina=12&orden=recientes", { items: [] }),
  ]);
  const categorias = (filtros.categorias ?? []).slice(0, 12);

  return (
    <div>
      {/* HERO */}
      <section className="bg-gradient-to-br from-[#1A1412] via-[#5A1A16] to-[#B82D25] text-white">
        <div className="max-w-6xl mx-auto px-4 py-16 sm:py-24">
          <p className="text-[#C9A96E] text-xs tracking-[0.3em] font-semibold">O.D.B PREMIUM MARKET</p>
          <h1 className="mt-3 text-3xl sm:text-5xl font-bold leading-tight max-w-2xl">
            Bebidas, fiambrería y almacén.<br />Tu pedido, a un toque.
          </h1>
          <p className="mt-4 text-white/70 max-w-lg">
            {cliente
              ? `Hola${cliente.nombre ? ", " + cliente.nombre.split(" ")[0] : ""} 👋 Estás viendo tus precios.`
              : "Entrá con tu email y mirá tus precios personalizados. Envío a domicilio y retiro en el local."}
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link href="/catalogo" className="bg-white text-[#1A1412] rounded-full px-6 py-3 font-semibold hover:bg-white/90">Ver catálogo</Link>
            <Link href="/catalogo?filtro=promo" className="bg-white/10 border border-white/20 rounded-full px-6 py-3 font-semibold hover:bg-white/20">Ofertas de hoy</Link>
          </div>
        </div>
      </section>

      <div className="max-w-6xl mx-auto px-4">
        {/* CATEGORÍAS */}
        {categorias.length > 0 && (
          <section className="-mt-8 relative">
            <div className="flex gap-3 overflow-x-auto sin-scroll pb-2">
              {categorias.map((c: any) => (
                <Link key={c.id} href={`/catalogo?categoriaId=${c.id}`} className="shrink-0 bg-white rounded-2xl border border-black/5 px-5 py-4 text-center hover:shadow-md transition-shadow min-w-[104px]">
                  <div className="text-3xl">{emojiCat(c.nombre)}</div>
                  <div className="text-xs font-medium text-[#2A201C] mt-1.5">{c.nombre}</div>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* OFERTAS */}
        {promo.items.length > 0 && (
          <Seccion titulo="Ofertas de la semana" href="/catalogo?filtro=promo">
            {promo.items.map((p) => <Producto key={p.sku} p={p} />)}
          </Seccion>
        )}

        {/* DESTACADOS / PARA VOS */}
        {destacados.items.length > 0 && (
          <Seccion titulo={cliente ? "Recomendados para vos" : "Recién llegados"} href="/catalogo">
            {destacados.items.map((p) => <Producto key={p.sku} p={p} />)}
          </Seccion>
        )}

        {/* COMUNIDAD CTA */}
        {!cliente?.verificado && (
          <section className="my-12 rounded-3xl bg-[#1A1412] text-white p-8 sm:p-10 flex flex-col sm:flex-row items-center gap-6">
            <div className="text-5xl">🎖️</div>
            <div className="flex-1 text-center sm:text-left">
              <h3 className="text-xl font-bold">Sumate a la Comunidad ODB</h3>
              <p className="text-white/65 mt-1 max-w-xl">Verificá tu identidad y desbloqueá precios de socio, prioridad en envíos a domicilio y puntos en cada compra.</p>
            </div>
            <Link href={cliente ? "/cuenta" : "/ingresar"} className="bg-[#C9A96E] text-[#1A1412] rounded-full px-6 py-3 font-semibold hover:bg-[#b8995d] whitespace-nowrap">
              {cliente ? "Verificar identidad" : "Crear mi cuenta"}
            </Link>
          </section>
        )}
      </div>
    </div>
  );
}

function Seccion({ titulo, href, children }: { titulo: string; href: string; children: React.ReactNode }) {
  return (
    <section className="mt-12">
      <div className="flex items-end justify-between mb-4">
        <h2 className="text-xl sm:text-2xl font-bold text-[#2A201C]">{titulo}</h2>
        <Link href={href} className="text-sm font-medium text-[#B82D25] hover:underline">Ver todo →</Link>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">{children}</div>
    </section>
  );
}
