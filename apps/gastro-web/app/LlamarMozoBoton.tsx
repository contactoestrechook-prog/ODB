"use client";

import { useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3002";

export function LlamarMozoBoton({ token, flotante = false }: { token: string; flotante?: boolean }) {
  const [estado, setEstado] = useState<"idle" | "enviando" | "avisado" | "error">("idle");

  async function llamar() {
    setEstado("enviando");
    try {
      const res = await fetch(`${API}/mesas/${token}/llamar-mozo`, { method: "POST" });
      if (!res.ok) throw new Error();
      setEstado("avisado");
      setTimeout(() => setEstado("idle"), 60_000);
    } catch {
      setEstado("error");
      setTimeout(() => setEstado("idle"), 4000);
    }
  }

  const contenido =
    estado === "avisado" ? "✓ Avisado, ya viene" : estado === "enviando" ? "Avisando…" : estado === "error" ? "No se pudo — probá de nuevo" : "🔔 Llamar al mozo";

  if (flotante) {
    return (
      <button
        onClick={llamar}
        disabled={estado === "enviando" || estado === "avisado"}
        className="fixed bottom-5 left-1/2 -translate-x-1/2 z-40 font-semibold text-sm py-3 px-6 rounded-full bg-gradient-to-br from-accent to-accent-2 text-[#1a1206] shadow-lg disabled:opacity-70"
      >
        {contenido}
      </button>
    );
  }

  return (
    <button
      onClick={llamar}
      disabled={estado === "enviando" || estado === "avisado"}
      className="block w-full text-center font-semibold text-sm py-3 rounded-xl border border-line disabled:opacity-70"
    >
      {contenido}
    </button>
  );
}
