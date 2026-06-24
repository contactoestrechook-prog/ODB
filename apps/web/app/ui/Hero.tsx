"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

export function Hero({ nombre }: { nombre?: string | null }) {
  const frameRef = useRef<HTMLDivElement>(null);
  const auraRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    // parallax sutil con el mouse
    const onMove = (e: MouseEvent) => {
      const x = e.clientX / window.innerWidth - 0.5;
      const y = e.clientY / window.innerHeight - 0.5;
      if (frameRef.current) frameRef.current.style.transform = `translate(${x * -10}px, ${y * -10}px)`;
      if (auraRef.current) auraRef.current.style.transform = `translate(${x * 26}px, ${y * 26}px)`;
    };
    window.addEventListener("mousemove", onMove);

    // partículas doradas flotando (polvo de cava)
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    let raf = 0;
    let parts: { x: number; y: number; r: number; vy: number; sway: number; ph: number; a: number }[] = [];
    const resize = () => {
      if (!canvas) return;
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
    };
    if (canvas && ctx) {
      resize();
      const n = window.innerWidth < 640 ? 16 : 30;
      parts = Array.from({ length: n }, () => ({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        r: Math.random() * 1.6 + 0.4,
        vy: -(Math.random() * 0.28 + 0.06),
        sway: Math.random() * 0.35 + 0.08,
        ph: Math.random() * Math.PI * 2,
        a: Math.random() * 0.4 + 0.12,
      }));
      const tick = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        for (const p of parts) {
          p.y += p.vy;
          p.ph += 0.01;
          p.x += Math.sin(p.ph) * p.sway;
          if (p.y < -6) { p.y = canvas.height + 6; p.x = Math.random() * canvas.width; }
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(240,235,226,${p.a})`;
          ctx.fill();
        }
        raf = requestAnimationFrame(tick);
      };
      tick();
      window.addEventListener("resize", resize);
    }
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <section className="bg-ink text-crema relative overflow-hidden">
      <div ref={auraRef} className="absolute inset-0 pointer-events-none deriva-glow" style={{ backgroundImage: "radial-gradient(58% 50% at 50% 32%, rgba(147,42,31,0.8), transparent 70%)" }} />
      <div className="absolute inset-0 pointer-events-none" style={{ backgroundImage: "radial-gradient(42% 36% at 50% 0%, rgba(184,45,37,0.18), transparent 70%)" }} />
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" aria-hidden />

      <div className="max-w-7xl mx-auto px-5 lg:px-8 py-16 lg:py-28 relative">
        <div ref={frameRef} className="border border-dorado/25 px-6 sm:px-14 py-16 sm:py-24 text-center" style={{ transition: "transform 0.25s ease-out" }}>
          <p className="kicker text-dorado entrar" style={{ animationDelay: "0.05s" }}>Vinos · Fiambrería · Almacén</p>
          <h1 className="mt-7 tracking-[-0.01em]">
            <span className="marca block text-[38px] sm:text-6xl lg:text-[74px] font-bold leading-[1.05] entrar" style={{ animationDelay: "0.18s" }}>El placer de lo bueno,</span>
            <span className="script block text-[46px] sm:text-7xl lg:text-[92px] text-dorado-claro leading-[1.15] pb-1 entrar" style={{ animationDelay: "0.34s" }}>a un toque.</span>
          </h1>
          <p className="mt-7 max-w-xl mx-auto text-crema/55 leading-relaxed entrar" style={{ animationDelay: "0.5s" }}>
            {nombre
              ? `Hola, ${nombre}. Estás viendo tus precios.`
              : "Curaduría de bodega, fiambrería de autor y almacén selecto. Entrá con tu email y mirá tus precios."}
          </p>
          <div className="mt-10 flex flex-wrap gap-3 justify-center entrar" style={{ animationDelay: "0.64s" }}>
            <Link href="/catalogo" className="bg-crema text-ink rounded-full px-8 py-3.5 text-sm font-semibold hover:bg-white transition-colors">Ver catálogo</Link>
            <Link href="/catalogo?filtro=promo" className="border border-dorado/50 text-dorado-claro rounded-full px-8 py-3.5 text-sm font-semibold hover:bg-dorado/10 transition-colors">Ofertas de la semana</Link>
          </div>
        </div>
      </div>

      <div className="absolute bottom-5 left-1/2 -translate-x-1/2 text-dorado/50 flotar pointer-events-none" aria-hidden>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M6 13l6 6 6-6" /></svg>
      </div>
    </section>
  );
}
