import Link from "next/link";

// Las tres formas de comprar en ODB, con lo que el sistema hace de verdad:
// - Pick-up: la app detecta cuando el cliente está a 400 m (GEOFENCE_M en
//   pedidos.service.ts), le asigna un estacionamiento libre y le avisa.
// - Compra Fácil: escanea en el local, paga con Mercado Pago y sale mostrando
//   un código que un empleado valida en la puerta (comprafacil.service.ts).
// Los pasos van numerados porque son una secuencia real.
type Forma = {
  nombre: string;
  bajada: string;
  pasos: string[];
  placa: string;
  icono: React.ReactNode;
  cta?: { texto: string; href: string };
};

const svg = (d: string) => (
  <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d={d} />
  </svg>
);

const FORMAS: Forma[] = [
  {
    nombre: "Envío a domicilio",
    bajada: "Te lo llevamos a tu casa.",
    pasos: ["Armá tu pedido en la tienda o en la app.", "Pagalo con Mercado Pago.", "Seguí al repartidor hasta tu puerta."],
    placa: "bg-crema text-ink",
    icono: svg("M3 7h11v9H3zM14 10h4l3 3v3h-7M7 19a2 2 0 100-4 2 2 0 000 4zM18 19a2 2 0 100-4 2 2 0 000 4z"),
    cta: { texto: "Hacer un pedido", href: "/catalogo" },
  },
  {
    nombre: "Pick-up: te lo llevamos al auto",
    bajada: "No te bajes del auto: estacionás y te lo acercamos.",
    pasos: [
      "Pedí para retirar en la app.",
      "Al salir, compartí tu ubicación. Cuando estás a 400 metros, te asignamos un estacionamiento.",
      "Estacionás en tu lugar y te llevamos el pedido al auto.",
    ],
    placa: "bg-rojo text-white",
    icono: svg("M5 17h14M6 17l1.5-5h9L18 17M8 12l1-3h6l1 3M7 20a1.5 1.5 0 100-3M17 20a1.5 1.5 0 100-3"),
    cta: { texto: "Descargá la app", href: "/#app" },
  },
  {
    nombre: "Compra Fácil: sin hacer fila",
    bajada: "Escaneás, pagás y te vas. Sin pasar por la caja.",
    pasos: [
      "En el local, escaneá los productos con la app.",
      "Pagá con Mercado Pago desde tu celular.",
      "Al salir, mostrá tu código en la puerta y listo.",
    ],
    placa: "bg-ink text-white",
    icono: svg("M4 7V5a1 1 0 011-1h2M17 4h2a1 1 0 011 1v2M20 17v2a1 1 0 01-1 1h-2M7 20H5a1 1 0 01-1-1v-2M7 12h10M9 9v6M12 9v6M15 9v6"),
    cta: { texto: "Descargá la app", href: "/#app" },
  },
];

export function ComoComprar() {
  return (
    <section id="como-comprar" className="max-w-7xl mx-auto px-5 lg:px-8 mt-16 scroll-mt-28">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2 mb-6">
        <h2 className="marca font-black leading-[1.04] tracking-[-0.02em] text-ink text-[32px] sm:text-[40px] [text-wrap:balance]">Comprá como quieras</h2>
        <p className="text-[14px] font-semibold text-humo max-w-[46ch]">Pagás con Mercado Pago en las tres. Compra Fácil pide tener la cuenta verificada en la Comunidad ODB.</p>
      </div>
      <div className="grid md:grid-cols-3 gap-3 sm:gap-4">
        {FORMAS.map((f) => (
          <article key={f.nombre} className={`flex flex-col min-w-0 rounded-[22px] p-6 sm:p-7 ${f.placa}`}>
            <span className="opacity-90">{f.icono}</span>
            <h3 className="marca font-black text-[24px] leading-[1.08] tracking-[-0.01em] mt-4 [text-wrap:balance]">{f.nombre}</h3>
            <p className="mt-2 text-[15px] font-semibold opacity-85">{f.bajada}</p>
            <ol className="mt-5 space-y-3">
              {f.pasos.map((p, i) => (
                <li key={i} className="flex gap-3 min-w-0">
                  <span className="shrink-0 w-7 h-7 rounded-full grid place-items-center text-[13px] font-extrabold bg-white/15 ring-1 ring-current/20">{i + 1}</span>
                  <span className="text-[14.5px] leading-snug pt-0.5 opacity-90">{p}</span>
                </li>
              ))}
            </ol>
            {f.cta && (
              <Link href={f.cta.href} className="mt-auto pt-6 inline-flex items-center gap-1.5 text-[14px] font-extrabold underline-offset-4 hover:underline">
                {f.cta.texto} <span aria-hidden>→</span>
              </Link>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
