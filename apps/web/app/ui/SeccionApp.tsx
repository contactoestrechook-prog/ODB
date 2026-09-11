import { InstalarApp } from "./InstalarApp";

// La app ODB. La tienda se instala como app hoy mismo (InstalarApp). Las
// tiendas de Apple y Google quedan marcadas "Muy pronto" porque la app todavía
// no está publicada: no hay link real para poner, y un botón que no lleva a
// ningún lado es peor que decirlo.
const PUEDE = [
  ["Compra Fácil", "Escaneás en el local, pagás y te vas sin hacer fila."],
  ["Pick-up al auto", "Te asignamos estacionamiento al llegar y te llevamos el pedido."],
  ["Tus precios de socio", "Con la cuenta verificada, ves tus precios en toda la tienda."],
  ["Tu pedido en vivo", "Seguís al repartidor o el estado de tu retiro."],
];

function Tienda({ nombre, sub }: { nombre: string; sub: string }) {
  return (
    <div aria-disabled className="inline-flex items-center gap-3 rounded-2xl bg-white/[0.08] ring-1 ring-white/15 px-4 h-14 min-w-0">
      <span className="min-w-0 leading-tight">
        <span className="block text-[11px] font-semibold text-white/60">{sub}</span>
        <span className="block text-[15px] font-extrabold text-white">{nombre}</span>
      </span>
      <span className="shrink-0 rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-extrabold text-white">Muy pronto</span>
    </div>
  );
}

export function SeccionApp() {
  return (
    <section id="app" className="max-w-7xl mx-auto px-5 lg:px-8 mt-16 scroll-mt-28">
      <div className="rounded-[28px] bg-rojo text-white grid lg:grid-cols-[1.1fr_1fr] gap-10 items-center px-7 sm:px-12 py-10 sm:py-12">
        <div className="min-w-0">
          <p className="text-[12px] font-bold tracking-[0.16em] uppercase text-white/75">Descargá la app</p>
          <h2 className="marca font-black leading-[1.02] tracking-[-0.02em] mt-3 text-[36px] sm:text-[50px] [text-wrap:balance]">ODB en tu celular</h2>
          <p className="mt-4 max-w-[46ch] text-[16px] leading-relaxed text-white/85">
            Instalala desde acá en un toque: queda el ícono de ODB junto a tus apps y entrás directo a la tienda.
          </p>
          <div className="mt-7">
            <InstalarApp />
          </div>
          <div className="mt-6 flex flex-wrap gap-3">
            <Tienda sub="Disponible en" nombre="App Store" />
            <Tienda sub="Disponible en" nombre="Google Play" />
          </div>
        </div>
        <ul className="grid sm:grid-cols-2 gap-3 min-w-0">
          {PUEDE.map(([t, d]) => (
            <li key={t} className="rounded-[18px] bg-white text-ink p-5 min-w-0">
              <p className="marca font-black text-[18px] leading-tight">{t}</p>
              <p className="mt-1.5 text-[14px] leading-snug text-tinta/75">{d}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
