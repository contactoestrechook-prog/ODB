"use client";

import { useEffect, useRef, useState } from "react";

// Banda del ODB Wine Fest con el video del evento como protagonista.
// El video es vertical (formato reel): va grande, en su propio marco, y el
// texto al lado, nunca encima. Arranca solo y sin sonido (los navegadores no
// dejan otra cosa); el botón activa el audio. Se oculta sola pasado el evento.
const ENTRADAS = "https://passcore.net/organizador/odb-premium-market-6a525b88e41c6e2b71e2c0b7";
const HASTA = new Date("2026-10-31T06:00:00-03:00"); // el día después de la fiesta

export function WineFest() {
  const video = useRef<HTMLVideoElement>(null);
  const [sonido, setSonido] = useState(false);
  const [vigente, setVigente] = useState(true);

  useEffect(() => {
    setVigente(Date.now() < HASTA.getTime());
    const v = video.current;
    if (!v) return;
    // con "reducir movimiento" no arranca solo: queda la portada y el botón
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // React no siempre deja puesto el atributo `muted` a tiempo, y sin él el
    // navegador bloquea la reproducción automática. Se fija a mano antes de
    // darle play, y se reintenta cuando el video terminó de cargar.
    v.muted = true;
    v.defaultMuted = true;
    const arrancar = () => v.play().catch(() => {});
    arrancar();
    v.addEventListener("canplay", arrancar, { once: true });
    return () => v.removeEventListener("canplay", arrancar);
  }, []);

  if (!vigente) return null;

  const alternarSonido = () => {
    const v = video.current;
    if (!v) return;
    v.muted = sonido;
    if (!sonido) { v.currentTime = 0; v.play().catch(() => {}); }
    setSonido(!sonido);
  };

  return (
    <section className="max-w-7xl mx-auto px-5 lg:px-8 mt-5">
      <div className="rounded-[28px] bg-rojo-osc text-white grid md:grid-cols-[1fr_auto] items-center gap-8 lg:gap-14 px-7 sm:px-12 py-10 sm:py-12">
        <div className="min-w-0 order-2 md:order-1">
          <p className="text-[12px] font-bold tracking-[0.16em] uppercase text-white/70">Tercera edición · Jueves 30 de octubre</p>
          <h2 className="marca font-black leading-[1.02] tracking-[-0.02em] [text-wrap:balance] mt-4 text-[40px] sm:text-[56px]">
            ODB Wine Fest 2026
          </h2>
          <p className="mt-4 text-[20px] sm:text-[22px] font-bold text-white/90">Lo bueno sucede puertas adentro.</p>
          <p className="mt-4 max-w-[44ch] text-[16px] leading-relaxed text-white/80">
            Cinco horas de vinos, bodegas y buena mesa en el local. En la edición pasada más de mil invitados respondieron a la convocatoria: el acceso general ya está disponible.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a href={ENTRADAS} target="_blank" rel="noopener" className="rounded-full bg-white px-7 h-12 inline-flex items-center text-[14px] font-extrabold text-rojo-osc hover:bg-crema transition-colors">
              Sacá tu entrada
            </a>
            <button type="button" onClick={alternarSonido} className="rounded-full border-2 border-white px-7 h-12 inline-flex items-center gap-2 text-[14px] font-bold text-white hover:bg-white hover:text-rojo-osc transition-colors">
              {sonido ? "Silenciar el video" : "Ver con sonido"}
            </button>
          </div>
        </div>

        <div className="order-1 md:order-2 justify-self-center">
          <div className="relative w-[240px] sm:w-[280px] lg:w-[300px] aspect-[480/854] rounded-[26px] overflow-hidden bg-black ring-[6px] ring-white/10 shadow-[0_30px_60px_-25px_rgba(0,0,0,0.6)]">
            <video
              ref={video}
              src="/video/odb-18-8.mp4"
              poster="/video/odb-18-8.jpg"
              muted
              autoPlay
              loop
              playsInline
              preload="metadata"
              aria-label="Video del ODB Wine Fest"
              className="absolute inset-0 w-full h-full object-cover"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
