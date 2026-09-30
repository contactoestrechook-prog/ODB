"use client";

import { useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3002";

type Idioma = "es" | "pt" | "en";
type Mensaje = { rol: "cliente" | "anfitrion"; texto: string };

const IDIOMAS: { valor: Idioma; etiqueta: string }[] = [
  { valor: "es", etiqueta: "ES" },
  { valor: "pt", etiqueta: "PT" },
  { valor: "en", etiqueta: "EN" },
];

const SALUDO: Record<Idioma, string> = {
  es: "¡Hola! Soy el Anfitrión de Gran Caminito 🥩 ¿Qué se te antoja hoy — carne, algo más liviano, o buscás un vino para acompañar?",
  pt: "Olá! Sou o Anfitrião do Gran Caminito 🥩 O que você quer hoje — carne, algo mais leve, ou está procurando um vinho?",
  en: "Hi! I'm the Gran Caminito host 🥩 What are you in the mood for today — meat, something lighter, or looking for a wine?",
};

const PLACEHOLDER: Record<Idioma, string> = {
  es: "Escribí tu consulta…",
  pt: "Escreva sua pergunta…",
  en: "Type your question…",
};

export function AnfitrionChat() {
  const [idioma, setIdioma] = useState<Idioma>("es");
  const [mensajes, setMensajes] = useState<Mensaje[]>([{ rol: "anfitrion", texto: SALUDO.es }]);
  const [input, setInput] = useState("");
  const [enviando, setEnviando] = useState(false);

  function cambiarIdioma(nuevo: Idioma) {
    setIdioma(nuevo);
    if (mensajes.length === 1) setMensajes([{ rol: "anfitrion", texto: SALUDO[nuevo] }]);
  }

  async function enviar() {
    const texto = input.trim();
    if (!texto || enviando) return;
    const historial = [...mensajes, { rol: "cliente" as const, texto }];
    setMensajes(historial);
    setInput("");
    setEnviando(true);
    try {
      const res = await fetch(`${API}/anfitrion/charlar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mensajes: historial, idioma }),
      });
      const data = await res.json();
      setMensajes([...historial, { rol: "anfitrion", texto: data.texto || "…" }]);
    } catch {
      setMensajes([...historial, { rol: "anfitrion", texto: "Uy, no te pude responder. Probá de nuevo en un momento." }]);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="entrar flex flex-col" style={{ minHeight: "calc(100vh - 3rem)" }}>
      <div className="flex items-center justify-between mb-5">
        <div>
          <p className="text-[10px] tracking-[0.14em] uppercase text-accent font-bold mb-1">Anfitrión</p>
          <h1 className="display text-xl font-bold">Gran Caminito</h1>
        </div>
        <div className="flex gap-1.5">
          {IDIOMAS.map((i) => (
            <button
              key={i.valor}
              onClick={() => cambiarIdioma(i.valor)}
              className={`text-xs font-bold px-2.5 py-1.5 rounded-lg border ${idioma === i.valor ? "border-accent bg-card text-accent" : "border-line text-faint"}`}
            >
              {i.etiqueta}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 flex flex-col gap-3 mb-4">
        {mensajes.map((m, i) => (
          <div key={i} className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
            m.rol === "anfitrion" ? "bg-card border border-line self-start" : "bg-gradient-to-br from-accent to-accent-2 text-[#1a1206] self-end font-medium"
          }`}>
            {m.texto}
          </div>
        ))}
        {enviando && <div className="max-w-[60%] rounded-2xl px-4 py-2.5 text-sm bg-card border border-line self-start text-faint">…</div>}
      </div>

      <div className="flex gap-2 sticky bottom-3">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && enviar()}
          placeholder={PLACEHOLDER[idioma]}
          disabled={enviando}
          className="flex-1 rounded-xl border border-line bg-card p-3 text-sm placeholder:text-faint"
        />
        <button
          onClick={enviar}
          disabled={enviando || !input.trim()}
          className="px-4 rounded-xl bg-gradient-to-br from-accent to-accent-2 text-[#1a1206] font-bold text-sm disabled:opacity-50"
        >
          ➤
        </button>
      </div>
    </div>
  );
}
