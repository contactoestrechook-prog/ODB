"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

// La puerta de entrada al asistente, en la portada: escribís o hablás y te
// lleva a /comprar con eso ya buscado.
const ATAJOS = ["Una picada para 6", "Un malbec para regalar", "Todo para un asado"];

export function EntradaAsistente() {
  const router = useRouter();
  const [texto, setTexto] = useState("");
  const [voz, setVoz] = useState(false);
  const [escuchando, setEscuchando] = useState(false);
  const rec = useRef<any>(null);

  useEffect(() => { setVoz(!!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)); }, []);

  const ir = (q: string) => router.push(q.trim() ? `/comprar?q=${encodeURIComponent(q.trim())}` : "/comprar");

  function hablar() {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    if (escuchando) { rec.current?.stop(); return; }
    const r = new SR();
    r.lang = "es-AR"; r.interimResults = true; r.continuous = false;
    let dicho = "";
    r.onresult = (e: any) => { dicho = Array.from(e.results).map((x: any) => x[0].transcript).join(" "); setTexto(dicho); };
    r.onend = () => { setEscuchando(false); if (dicho.trim()) ir(dicho); };
    r.onerror = () => setEscuchando(false);
    rec.current = r; r.start(); setEscuchando(true);
  }

  return (
    <div className="rounded-[24px] bg-white text-ink p-5 sm:p-7 shadow-[0_24px_50px_-24px_rgba(0,0,0,0.5)] min-w-0">
      <p className="text-[12px] font-bold tracking-[0.16em] uppercase text-rojo">Comprá con ayuda</p>
      <p className="marca font-black text-[26px] sm:text-[30px] leading-[1.05] tracking-[-0.01em] mt-2 [text-wrap:balance]">Decime qué estás buscando</p>
      <p className="mt-2 text-[14.5px] text-humo leading-snug">Escribilo o hablalo. Te muestro lo que tenemos y lo sumás al carrito.</p>
      <form onSubmit={(e) => { e.preventDefault(); ir(texto); }} className="mt-5 flex items-center gap-2 rounded-full border-2 border-ink pl-4 pr-1.5 h-13 min-h-[52px] focus-within:border-rojo transition-colors">
        <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder={escuchando ? "Te escucho…" : "Ej: vino y queso para esta noche"} aria-label="Qué estás buscando" className="min-w-0 flex-1 bg-transparent outline-none text-[15px] placeholder:text-humo" />
        {voz && (
          <button type="button" onClick={hablar} aria-label={escuchando ? "Dejar de escuchar" : "Hablar"} className={`shrink-0 grid place-items-center w-10 h-10 rounded-full transition-colors ${escuchando ? "bg-rojo text-white animate-pulse" : "bg-crema text-ink hover:bg-crema-prof"}`}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 15a3 3 0 003-3V6a3 3 0 00-6 0v6a3 3 0 003 3zM19 11a7 7 0 01-14 0M12 18v3" /></svg>
          </button>
        )}
      </form>
      <button type="button" onClick={() => ir(texto)} className="mt-3 w-full rounded-full bg-rojo text-white h-12 text-[15px] font-extrabold hover:bg-rojo-osc transition-colors">
        Empezá a comprar
      </button>
      <div className="mt-4 flex flex-wrap gap-2">
        {ATAJOS.map((a) => (
          <button key={a} type="button" onClick={() => ir(a)} className="rounded-full bg-crema hover:bg-crema-prof px-3.5 h-9 text-[13px] font-bold text-ink transition-colors">{a}</button>
        ))}
      </div>
    </div>
  );
}
