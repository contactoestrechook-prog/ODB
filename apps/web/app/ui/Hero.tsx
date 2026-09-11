import { Titulo } from "./Titulo";
import { EntradaAsistente } from "./EntradaAsistente";

// Portada "placa roja". A la izquierda el lema de la marca; a la derecha, la
// entrada al asistente de compras: escribís o hablás lo que buscás y te arma
// la compra. Nada de paredes de productos (pedido de Leandro, 11/9/2026).
export function Hero({ nombre }: { nombre?: string | null }) {
  return (
    <section className="max-w-7xl mx-auto px-5 lg:px-8 pt-6">
      <div className="relative overflow-hidden rounded-[28px] bg-rojo text-white grid lg:grid-cols-[1.05fr_1fr] items-center">
        {/* círculo rojo oscuro: el único adorno, detrás de la columna del asistente */}
        <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 w-[520px] h-[520px] rounded-full bg-rojo-osc hidden lg:block" />

        <div className="relative z-10 min-w-0 px-7 sm:px-12 pt-10 sm:pt-14 lg:py-14">
          <p className="text-[12px] font-bold tracking-[0.16em] uppercase text-white/75">Canning · Almacén, fiambrería, bebidas</p>
          <Titulo como="h1" tono="rojo" a="El placer de lo bueno," b="a un toque." className="mt-4 text-[42px] sm:text-[58px] lg:text-[66px]" />
          <p className="mt-5 max-w-[42ch] text-[16px] leading-relaxed text-white/85">
            {nombre
              ? `Hola, ${nombre}. Contame qué necesitás y te lo muestro con tus precios de socio.`
              : "Más de 10.000 productos de almacén gourmet, fiambrería, bebidas y bodega. No hace falta recorrerlos: contame qué buscás y te lo muestro."}
          </p>
        </div>

        <div className="relative z-10 min-w-0 px-7 sm:px-12 lg:pl-0 py-10 lg:py-12">
          <EntradaAsistente />
        </div>
      </div>
    </section>
  );
}
