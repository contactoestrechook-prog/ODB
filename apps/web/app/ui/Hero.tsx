import Link from "next/link";
import { Titulo } from "./Titulo";
import { pesos, type Producto } from "../../lib/tipos";

// Portada "placa roja": la placa del logo es la estructura. Texto a la
// izquierda y productos a la derecha, cada cosa en su columna: ninguna foto
// pasa por debajo de un texto. Las fotos del catálogo vienen sobre fondo
// blanco, así que van en su propia placa blanca en vez de flotar sobre el rojo
// (sueltas se veían como rectángulos pegados).
export function Hero({ nombre, vitrina }: { nombre?: string | null; vitrina: Producto[] }) {
  const fotos = vitrina.filter((p) => p.imagenUrl).slice(0, 2);
  return (
    <section className="max-w-7xl mx-auto px-5 lg:px-8 pt-6">
      <div className="relative overflow-hidden rounded-[28px] bg-rojo text-white grid lg:grid-cols-[1.05fr_1fr]">
        {/* círculo rojo oscuro: el único adorno, y vive detrás de la columna de fotos */}
        <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 w-[520px] h-[520px] rounded-full bg-rojo-osc hidden lg:block" />

        <div className="relative z-10 min-w-0 px-7 sm:px-12 py-10 sm:py-14 self-center">
          <p className="text-[12px] font-bold tracking-[0.16em] uppercase text-white/75">Canning · Almacén, fiambrería, bebidas</p>
          <Titulo como="h1" tono="rojo" a="El placer de lo bueno," b="a un toque." className="mt-4 text-[42px] sm:text-[58px] lg:text-[66px]" />
          <p className="mt-5 max-w-[42ch] text-[16px] leading-relaxed text-white/85">
            {nombre
              ? `Hola, ${nombre}. Estás viendo tus precios de socio.`
              : "Almacén gourmet, fiambrería, quesos, bebidas y bodega: más de 10.000 productos. Te lo llevamos o lo retirás en el local."}
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/catalogo" className="rounded-full bg-white px-7 h-12 inline-flex items-center text-[14px] font-extrabold text-rojo hover:bg-crema transition-colors">Entrar a la tienda</Link>
            <Link href="/catalogo?filtro=promo" className="rounded-full border-2 border-white px-7 h-12 inline-flex items-center text-[14px] font-bold text-white hover:bg-white hover:text-rojo transition-colors">Ofertas de la semana</Link>
          </div>
        </div>

        {fotos.length > 0 && (
          <div className="relative z-10 min-w-0 px-7 sm:px-12 lg:pl-0 pb-10 lg:py-12 grid grid-cols-2 gap-4 self-center">
            {fotos.map((p, i) => (
              <Link
                key={p.sku}
                href={`/producto/${p.sku}`}
                className={`group rounded-[22px] bg-white p-4 text-ink shadow-[0_18px_40px_-18px_rgba(0,0,0,0.45)] ${i === 1 ? "lg:mt-10" : ""}`}
              >
                <div className="aspect-[4/5] grid place-items-center overflow-hidden rounded-[14px]">
                  <img src={p.imagenUrl!} alt={p.nombre} className="w-full h-full object-contain transition-transform duration-500 group-hover:scale-[1.05]" />
                </div>
                <p className="mt-3 text-[13px] font-semibold leading-snug line-clamp-2 min-h-[2.5em]">{p.nombre}</p>
                <p className="marca mt-1 text-[22px] font-extrabold leading-none">{pesos(p.precio)}</p>
              </Link>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
