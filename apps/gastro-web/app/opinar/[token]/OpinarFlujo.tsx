"use client";

import { useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3002";

type Sentimiento = "contento" | "neutral" | "molesto";

const OPCIONES: { valor: Sentimiento; emoji: string; etiqueta: string }[] = [
  { valor: "contento", emoji: "😊", etiqueta: "Todo bien" },
  { valor: "neutral", emoji: "😐", etiqueta: "Más o menos" },
  { valor: "molesto", emoji: "😞", etiqueta: "Hubo un problema" },
];

export function OpinarFlujo({ token }: { token: string }) {
  const [sentimiento, setSentimiento] = useState<Sentimiento | null>(null);
  const [comentario, setComentario] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<{ linkGoogle: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function elegir(valor: Sentimiento) {
    setSentimiento(valor);
    // "contento" no necesita comentario: se manda directo. Los otros dos
    // esperan que el cliente cuente qué pasó antes de enviar.
    if (valor === "contento") await enviar(valor, "");
  }

  async function enviar(valor: Sentimiento, texto: string) {
    setEnviando(true);
    setError(null);
    try {
      const res = await fetch(`${API}/termometro`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mesaToken: token, sentimiento: valor, comentario: texto || undefined }),
      });
      if (!res.ok) throw new Error("No se pudo enviar");
      setResultado(await res.json());
    } catch {
      setError("No se pudo enviar tu opinión. Probá de nuevo en un momento.");
    } finally {
      setEnviando(false);
    }
  }

  if (resultado) {
    return (
      <div className="entrar text-center pt-10">
        <p className="text-4xl mb-4">🙏</p>
        <h1 className="display text-xl font-bold mb-2">¡Gracias por contarnos!</h1>
        {resultado.linkGoogle ? (
          <>
            <p className="text-dim text-sm mb-6">
              Nos encantaría que lo compartas en Google, nos ayuda un montón.
            </p>
            <a
              href={resultado.linkGoogle}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block font-semibold text-sm py-3 px-6 rounded-xl bg-gradient-to-br from-accent to-accent-2 text-[#1a1206]"
            >
              Dejar una reseña en Google
            </a>
          </>
        ) : (
          <p className="text-dim text-sm">
            Ya avisamos al encargado. Si todavía estás en la mesa, en un momento se acerca.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="entrar pt-8">
      <h1 className="display text-xl font-bold text-center mb-8">¿Cómo estuvo tu visita?</h1>

      <div className="flex justify-center gap-3 mb-6">
        {OPCIONES.map((op) => (
          <button
            key={op.valor}
            onClick={() => elegir(op.valor)}
            disabled={enviando}
            className={`flex flex-col items-center gap-2 py-4 px-3 rounded-2xl border transition ${
              sentimiento === op.valor ? "border-accent bg-card" : "border-line"
            }`}
          >
            <span className="text-3xl">{op.emoji}</span>
            <span className="text-[11px] text-dim">{op.etiqueta}</span>
          </button>
        ))}
      </div>

      {sentimiento && sentimiento !== "contento" && (
        <div className="flex flex-col gap-3">
          <textarea
            value={comentario}
            onChange={(e) => setComentario(e.target.value)}
            placeholder="Contanos qué pasó (opcional, pero nos ayuda a mejorar ya mismo)"
            rows={3}
            className="w-full rounded-xl border border-line bg-card p-3 text-sm placeholder:text-faint"
          />
          <button
            onClick={() => enviar(sentimiento, comentario)}
            disabled={enviando}
            className="font-semibold text-sm py-3 rounded-xl bg-gradient-to-br from-accent to-accent-2 text-[#1a1206] disabled:opacity-60"
          >
            {enviando ? "Enviando…" : "Enviar"}
          </button>
        </div>
      )}

      {error && <p className="text-loss text-xs text-center mt-4">{error}</p>}
    </div>
  );
}
