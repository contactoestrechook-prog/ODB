"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useCarrito } from "../../lib/carrito";
import { pesos, type Producto as P } from "../../lib/tipos";
import { Producto } from "./Producto";

// Compra guiada con IA. La persona escribe o habla lo que busca; el asistente
// busca en el catálogo real y muestra lo de ese rubro, agrupado, para agregar
// al carrito sin salir de la charla. Pocos productos por vez: una compra
// guiada, no una góndola (pedido de Leandro, 11/9/2026).
type Turno =
  | { rol: "usuario"; texto: string }
  | { rol: "asistente"; texto: string; grupos: { titulo: string; items: P[] }[]; sugerencias: string[] };

const EJEMPLOS = [
  "Una picada para 6",
  "Un malbec para regalar",
  "Todo para un asado",
  "Algo dulce importado",
  "Vino y queso para esta noche",
];

export function Asistente({ inicial = "" }: { inicial?: string }) {
  const [turnos, setTurnos] = useState<Turno[]>([]);
  const [texto, setTexto] = useState("");
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");
  const [escuchando, setEscuchando] = useState(false);
  const [voz, setVoz] = useState(false);
  const rec = useRef<any>(null);
  const fin = useRef<HTMLDivElement>(null);
  const arranco = useRef(false);
  const { unidades, total } = useCarrito();

  useEffect(() => {
    setVoz(!!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition));
  }, []);

  useEffect(() => {
    if (inicial && !arranco.current) { arranco.current = true; enviar(inicial); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inicial]);

  useEffect(() => { fin.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [turnos, cargando]);

  async function enviar(t: string) {
    const limpio = t.trim();
    if (!limpio || cargando) return;
    setError("");
    setTexto("");
    const nuevos: Turno[] = [...turnos, { rol: "usuario", texto: limpio }];
    setTurnos(nuevos);
    setCargando(true);
    try {
      const r = await fetch("/api/asistente", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mensajes: nuevos.map((x) => ({ rol: x.rol, texto: x.texto })) }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.message || "No pude buscar ahora. Probá de nuevo.");
      setTurnos((ts) => [...ts, { rol: "asistente", texto: d.mensaje ?? "", grupos: d.grupos ?? [], sugerencias: d.sugerencias ?? [] }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pude buscar ahora. Probá de nuevo.");
    } finally {
      setCargando(false);
    }
  }

  function hablar() {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    if (escuchando) { rec.current?.stop(); return; }
    const r = new SR();
    r.lang = "es-AR";
    r.interimResults = true;
    r.continuous = false;
    let dicho = "";
    r.onresult = (e: any) => {
      dicho = Array.from(e.results).map((x: any) => x[0].transcript).join(" ");
      setTexto(dicho);
    };
    r.onend = () => { setEscuchando(false); if (dicho.trim()) enviar(dicho); };
    r.onerror = () => setEscuchando(false);
    rec.current = r;
    r.start();
    setEscuchando(true);
  }

  const vacio = turnos.length === 0;

  return (
    // Alto mínimo de pantalla y barra "sticky" (no "fixed"): así la barra queda
    // siempre a mano mientras se baja, pero nunca flota encima del pie de página.
    <div className="max-w-5xl mx-auto px-5 lg:px-8 pt-8 min-h-[calc(100svh-120px)] flex flex-col">
      {vacio && (
        <div className="pt-6 sm:pt-14 text-center">
          <p className="text-[12px] font-bold tracking-[0.16em] uppercase text-rojo">Comprá con ayuda</p>
          <h1 className="marca font-black text-ink leading-[1.02] tracking-[-0.02em] mt-3 text-[40px] sm:text-[60px] [text-wrap:balance]">¿Qué estás buscando?</h1>
          <p className="mt-4 mx-auto max-w-[48ch] text-[16px] text-humo leading-relaxed">
            Escribilo o decilo como se lo dirías a alguien del local. Te muestro lo que tenemos y lo sumás al carrito desde acá.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-2">
            {EJEMPLOS.map((e) => (
              <button key={e} type="button" onClick={() => enviar(e)} className="rounded-full border-2 border-ink/15 hover:border-ink bg-white px-4 h-11 text-[14px] font-bold text-ink transition-colors">
                {e}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex-1 space-y-8 pb-8">
        {turnos.map((t, i) =>
          t.rol === "usuario" ? (
            <div key={i} className="flex justify-end">
              <p className="max-w-[80%] rounded-[22px] rounded-br-md bg-ink text-white px-5 py-3 text-[15px] leading-snug [overflow-wrap:anywhere]">{t.texto}</p>
            </div>
          ) : (
            <div key={i} className="min-w-0">
              <div className="flex items-start gap-3">
                <span aria-hidden className="shrink-0 w-9 h-9 rounded-full bg-rojo grid place-items-center text-white marca font-black text-[13px]">O</span>
                <p className="min-w-0 pt-1.5 text-[16px] leading-relaxed text-ink [overflow-wrap:anywhere]">{t.texto}</p>
              </div>
              {t.grupos.map((g) => (
                <section key={g.titulo} className="mt-6 min-w-0">
                  <h2 className="marca font-black text-[22px] text-ink leading-tight">{g.titulo}</h2>
                  <div className="mt-3 -mx-5 px-5 lg:mx-0 lg:px-0 flex gap-3 overflow-x-auto sin-scroll snap-x pb-2">
                    {g.items.map((p) => (
                      <div key={p.sku} className="snap-start shrink-0 w-[172px] sm:w-[200px]">
                        <Producto p={p} />
                      </div>
                    ))}
                  </div>
                </section>
              ))}
              {t.sugerencias.length > 0 && i === turnos.length - 1 && (
                <div className="mt-5 flex flex-wrap gap-2">
                  {t.sugerencias.map((s) => (
                    <button key={s} type="button" onClick={() => enviar(s)} className="rounded-full bg-crema hover:bg-crema-prof px-4 h-10 text-[13.5px] font-bold text-ink transition-colors">
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ),
        )}

        {cargando && (
          <div className="flex items-center gap-3" role="status">
            <span aria-hidden className="shrink-0 w-9 h-9 rounded-full bg-rojo grid place-items-center text-white marca font-black text-[13px]">O</span>
            <span className="text-[15px] text-humo">Buscando en la tienda</span>
            <span className="flex gap-1" aria-hidden>
              <span className="w-1.5 h-1.5 rounded-full bg-rojo animate-bounce" />
              <span className="w-1.5 h-1.5 rounded-full bg-rojo animate-bounce [animation-delay:120ms]" />
              <span className="w-1.5 h-1.5 rounded-full bg-rojo animate-bounce [animation-delay:240ms]" />
            </span>
          </div>
        )}
        {error && (
          <div className="rounded-[18px] bg-crema px-5 py-4 text-[15px] text-ink">
            {error}{" "}
            <button type="button" onClick={() => { const u = [...turnos].reverse().find((t) => t.rol === "usuario"); if (u) { setTurnos((ts) => ts.slice(0, -1)); enviar(u.texto); } }} className="font-bold text-rojo underline underline-offset-4">Probar de nuevo</button>
          </div>
        )}
        <div ref={fin} />
      </div>

      {/* barra de abajo: el carrito siempre a la vista y dónde escribir o hablar */}
      <div className="sticky bottom-0 z-40 -mx-5 px-5 lg:mx-0 lg:px-0 bg-gradient-to-t from-white via-white to-white/0 pt-6 pb-4">
        <div className="space-y-3">
          {unidades > 0 && (
            <Link href="/carrito" className="flex items-center justify-between gap-3 rounded-full bg-ink text-white pl-5 pr-2 h-12 min-w-0">
              <span className="min-w-0 truncate text-[14px] font-bold">Tu carrito · {unidades} {unidades === 1 ? "producto" : "productos"} · {pesos(total)}</span>
              <span className="shrink-0 rounded-full bg-rojo px-4 h-9 inline-flex items-center text-[13px] font-extrabold">Ir a pagar →</span>
            </Link>
          )}
          <form onSubmit={(e) => { e.preventDefault(); enviar(texto); }} className="flex items-center gap-2 rounded-full border-2 border-ink bg-white pl-5 pr-1.5 h-14 shadow-[0_12px_30px_-18px_rgba(0,0,0,0.35)] focus-within:border-rojo transition-colors">
            <input
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder={escuchando ? "Te escucho…" : vacio ? "Ej: una picada para 6 con vino" : "Pedile algo más, o cambiá lo que te mostré"}
              className="min-w-0 flex-1 bg-transparent outline-none text-[15px] placeholder:text-humo"
              maxLength={500}
              aria-label="Qué estás buscando"
            />
            {voz && (
              <button type="button" onClick={hablar} aria-label={escuchando ? "Dejar de escuchar" : "Hablar"} className={`shrink-0 grid place-items-center w-11 h-11 rounded-full transition-colors ${escuchando ? "bg-rojo text-white animate-pulse" : "bg-crema text-ink hover:bg-crema-prof"}`}>
                <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 15a3 3 0 003-3V6a3 3 0 00-6 0v6a3 3 0 003 3zM19 11a7 7 0 01-14 0M12 18v3" /></svg>
              </button>
            )}
            <button type="submit" disabled={!texto.trim() || cargando} className="shrink-0 rounded-full bg-rojo text-white h-11 px-5 text-[14px] font-extrabold disabled:opacity-40 hover:bg-rojo-osc transition-colors">
              Buscar
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
