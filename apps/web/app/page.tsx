import Link from "next/link";
import { apiJson } from "../lib/api";
import { sesion } from "../lib/sesion";
import { Producto } from "./ui/Producto";
import { Hero } from "./ui/Hero";
import { WineFest } from "./ui/WineFest";
import { ComoComprar } from "./ui/ComoComprar";
import { SeccionApp } from "./ui/SeccionApp";
import { Titulo } from "./ui/Titulo";
import { IcoUva, IcoMoto, IcoMedalla, IcoFlecha, IcoTarjeta } from "./ui/Iconos";
import type { Producto as P } from "../lib/tipos";

export const dynamic = "force-dynamic";

// Cabecera de sección: título (un solo color) a la izquierda y el "ver todo"
// alineado a la misma base. flex-wrap para que en celular el link baje en vez
// de pisar el título.
function Seccion({ a, b, href, texto = "Ver todo" }: { a: string; b: string; href?: string; texto?: string }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2 mb-6">
      <Titulo a={a} b={b} className="text-[32px] sm:text-[40px] min-w-0" />
      {href && (
        <Link href={href} className="shrink-0 inline-flex items-center gap-1.5 text-[14px] font-bold text-rojo hover:text-rojo-osc transition-colors group">
          {texto} <IcoFlecha size={16} className="group-hover:translate-x-0.5 transition-transform" />
        </Link>
      )}
    </div>
  );
}

// La portada es de un PREMIUM MARKET, no de una vinoteca: los vinos son una
// parte del stock. Se reparte por rubro (turno: uno de cada uno) y lo que se
// encuentra buscando —limpieza, higiene— no va en la vidriera.
const RUBROS: [string, RegExp][] = [
  ["almacen", /aceite|conserva|pasta|fideo|salsa|aderezo|condiment|delicat|arroz|harina|infusi|caf[eé]|yerba|especia|miel|mermelad|encurt|aceitun/i],
  ["fiambreria", /queso|fiambre|chacin|l[aá]cteo|embut|tambo|carnic/i],
  ["bebidas", /vino|malbec|cabernet|corte|espumant|champ|whisk|gin|vermu|aperit|destil|cerveza|licor|agua|jugo|gaseos/i],
  ["dulces", /chocolat|golosin|alfajor|galletit|dulce|snack|turr[oó]n|caramel/i],
];
const NUNCA = /limpi|higien|lavandin|detergen|jab[oó]n|papel|pa[ñn]al|desodor|shampoo|insectic|aerosol|adhesiv|bolsa|esponj|depila|algod|pilas|encendedor|tabaco|cigarr/i;
const rubroDe = (n: string) => RUBROS.findIndex(([, re]) => re.test(n));
// Dentro de cada rubro va primero lo que hace a un PREMIUM market. Ordenar solo
// por cantidad de fotos ponía Nesquik y Actimel en la vitrina e "infusiones" y
// "lácteos" como primeros estantes: lo masivo tiene más fotos, no más encanto.
const GOURMET = /delicat|aceite|gourmet|importad|queso|fiambre|jam[oó]n|vino|malbec|espumant|champ|whisk|chocolates? importad|chocolat|conserva|pasta|especia|aceitun/i;
function repartirPorRubro(cats: any[]) {
  const colas: any[][] = RUBROS.map(() => []);
  const otros: any[] = [];
  for (const c of cats) {
    if (NUNCA.test(c.nombre)) continue;
    const r = rubroDe(c.nombre);
    (r >= 0 ? colas[r] : otros).push(c);
  }
  const g = (c: any) => (GOURMET.test(c.nombre) ? 0 : 1);
  for (const q of colas) q.sort((a, b) => g(a) - g(b) || (b.productos ?? 0) - (a.productos ?? 0));
  const salida: any[] = [];
  while (colas.some((q) => q.length)) for (const q of colas) if (q.length) salida.push(q.shift());
  return salida.concat(otros);
}

// Las cuatro placas del kit, en orden: negra, crema, rojo oscuro, blanca con borde.
const PLACAS = [
  "bg-ink text-white",
  "bg-crema text-ink",
  "bg-rojo-osc text-white",
  "bg-white text-ink ring-2 ring-inset ring-ink",
];

export default async function Home() {
  const cliente = await sesion();
  const [filtros, promo] = await Promise.all([
    apiJson<{ categorias: any[] }>("/catalogo/categorias-destacadas?limite=40", { categorias: [] }),
    apiJson<{ items: P[] }>("/productos?filtro=promo&porPagina=10", { items: [] }),
  ]);
  const categorias = repartirPorRubro(filtros.categorias ?? []).slice(0, 8);
  // Un estante por rubro distinto: almacén, fiambrería, bebidas, dulces.
  // Estantes y vitrina solo con lo gourmet de cada rubro. Quesos y fiambres
  // casi no tienen foto (son de balanza, sin código de barras), así que el rubro
  // fiambrería quedaba representado por "lácteos" y la vitrina mostraba un
  // Actimel. Si un rubro no tiene una categoría gourmet con fotos, ese rubro va
  // en la grilla de categorías pero no en los estantes.
  const estantes = RUBROS.map((_, r) => categorias.find((c: any) => rubroDe(c.nombre) === r && GOURMET.test(c.nombre)))
    .filter(Boolean)
    .slice(0, 3);
  const filas = await Promise.all(
    estantes.map((c: any) =>
      apiJson<{ items: P[] }>(`/productos?categoriaId=${c.id}&porPagina=7&orden=foto`, { items: [] }).then((r) => ({
        cat: c,
        items: (r.items ?? []).filter((p) => p.imagenUrl),
      })),
    ),
  );
  // La vitrina mezcla rubros: el primero de dos estantes distintos.
  const vitrina = filas.slice(0, 2).map((f) => f.items[0]).filter(Boolean) as P[];

  return (
    <div className="pb-6">
      <Hero nombre={cliente?.nombre ? cliente.nombre.split(" ")[0] : null} vitrina={vitrina} />

      {/* el Wine Fest, con su video, justo debajo de la portada */}
      <WineFest />

      {/* las tres formas de comprar: domicilio, pick-up al auto y Compra Fácil */}
      <ComoComprar />

      <div className="max-w-7xl mx-auto px-5 lg:px-8">
        {/* ───────── CATEGORÍAS: placas de color con la foto en su propio pozo ───────── */}
        {categorias.length > 0 && (
          <section className="mt-14">
            <Seccion a="Recorré" b="la tienda" href="/catalogo" texto="Todas las categorías" />
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
              {categorias.map((c: any, i: number) => (
                <Link
                  key={c.id}
                  href={`/catalogo?categoriaId=${c.id}`}
                  className={`group flex flex-col min-w-0 rounded-[22px] p-3 sm:p-4 transition-transform duration-300 hover:-translate-y-0.5 ${PLACAS[i % PLACAS.length]}`}
                >
                  <div className="min-w-0 px-1">
                    <p className="marca text-[20px] sm:text-[24px] font-extrabold leading-[1.05] line-clamp-2 [overflow-wrap:anywhere] capitalize">{c.nombre.toLowerCase()}</p>
                    {c.productos > 0 && <p className="mt-1 text-[12px] font-semibold opacity-70">{c.productos} productos</p>}
                  </div>
                  <div className="relative mt-3 aspect-[4/3] rounded-[14px] bg-white overflow-hidden">
                    {c.imagenUrl
                      ? <img src={c.imagenUrl} alt="" className="absolute inset-0 w-full h-full object-contain p-2 transition-transform duration-500 group-hover:scale-[1.06]" />
                      : <img src="/odb-logo.png" alt="" className="absolute inset-0 m-auto h-9 w-auto opacity-30" />}
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* ───────── ESTANTES: uno por rubro, con productos reales de cada categoría ───────── */}
        {filas.map((f, i) =>
          f.items.length >= 3 ? (
            <section key={f.cat.id} className="mt-16">
              <Seccion
                a={String(f.cat.nombre).charAt(0).toUpperCase() + String(f.cat.nombre).slice(1).toLowerCase()}
                b=""
                href={`/catalogo?categoriaId=${f.cat.id}`}
                texto={`Ver los ${f.cat.productos}`}
              />
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4">
                {f.items.slice(i < 2 ? 1 : 0, (i < 2 ? 1 : 0) + 5).map((p) => <Producto key={p.sku} p={p} />)}
              </div>
            </section>
          ) : null,
        )}

        {/* ───────── OFERTAS ───────── */}
        {promo.items.length > 0 && (
          <section className="mt-16">
            <Seccion a="Ofertas" b="de la semana" href="/catalogo?filtro=promo" texto="Ver todas las ofertas" />
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4">
              {promo.items.map((p) => <Producto key={p.sku} p={p} />)}
            </div>
          </section>
        )}
      </div>

      {/* ───────── LA APP ───────── */}
      <SeccionApp />

      {/* ───────── COMUNIDAD: placa negra ───────── */}
      <section className="max-w-7xl mx-auto px-5 lg:px-8 mt-16">
        <div className="rounded-[28px] bg-ink text-crema px-7 sm:px-12 py-12 grid lg:grid-cols-2 gap-10 items-center">
          <div className="min-w-0">
            <p className="text-[12px] font-bold tracking-[0.16em] uppercase text-dorado-claro">Club de clientes</p>
            <Titulo tono="oscuro" a="Sumate a la" b="Comunidad ODB" className="mt-3 text-[36px] sm:text-[52px]" />
            <p className="mt-5 text-crema/70 max-w-[46ch] leading-relaxed">
              Verificá tu identidad una sola vez y comprá con precios de socio, prioridad en los envíos y puntos en cada compra.
            </p>
            <Link href={cliente ? "/cuenta" : "/ingresar"} className="inline-flex items-center gap-2 mt-8 bg-rojo text-white rounded-full px-7 h-12 text-[14px] font-bold hover:bg-rojo-osc transition-colors">
              {cliente ? "Verificar mi identidad" : "Crear mi cuenta"} <IcoFlecha size={16} />
            </Link>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[
              [<IcoTarjeta key="t" size={20} />, "Precios de socio", "En toda la tienda"],
              [<IcoMoto key="m" size={20} />, "Prioridad en envíos", "Tu pedido sale primero"],
              [<IcoMedalla key="d" size={20} />, "Puntos en cada compra", "Canjealos por productos"],
              [<IcoUva key="u" size={20} />, "Etiquetas para socios", "Selección exclusiva"],
            ].map(([ico, t, s], i) => (
              <div key={i} className="rounded-[18px] bg-white/[0.06] ring-1 ring-white/10 p-5 min-w-0">
                <span className="text-dorado-claro">{ico}</span>
                <p className="mt-3 text-[15px] font-bold text-crema">{t}</p>
                <p className="text-[13px] text-crema/60 mt-0.5">{s}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
