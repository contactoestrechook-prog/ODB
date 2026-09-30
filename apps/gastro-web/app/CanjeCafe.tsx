"use client";

import { useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3002";

// "Dejá tu WhatsApp → café de cortesía". Consentimiento explícito y a la
// vista: el cliente sabe exactamente qué da y qué recibe.
export function CanjeCafe({ token }: { token: string }) {
  const [abierto, setAbierto] = useState(false);
  const [telefono, setTelefono] = useState("");
  const [nombre, setNombre] = useState("");
  const [estado, setEstado] = useState<"idle" | "enviando" | "ok">("idle");
  const [error, setError] = useState<string | null>(null);

  async function canjear() {
    setEstado("enviando");
    setError(null);
    try {
      const res = await fetch(`${API}/mesas/${token}/canjear-cafe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ telefono, nombre: nombre || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || "No se pudo canjear");
      setEstado("ok");
    } catch (e: any) {
      setEstado("idle");
      setError(e.message);
    }
  }

  if (estado === "ok") {
    return (
      <div className="rounded-xl border border-good/40 bg-good/10 p-4 text-center">
        <p className="text-2xl mb-1">☕</p>
        <p className="text-sm font-semibold text-good">¡Listo! Tu café ya está en marcha.</p>
        <p className="text-faint text-xs mt-1">Te vamos a escribir solo por cosas que valgan la pena — vinos que no se consiguen y beneficios.</p>
      </div>
    );
  }

  if (!abierto) {
    return (
      <button
        onClick={() => setAbierto(true)}
        className="block w-full text-center font-semibold text-sm py-3 rounded-xl border border-accent/40 bg-accent/10 text-accent"
      >
        ☕ Café de cortesía dejando tu WhatsApp
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-line bg-card p-4 text-left">
      <p className="text-sm font-semibold mb-1">Un café de la casa ☕</p>
      <p className="text-faint text-xs mb-3">
        Dejanos tu WhatsApp y te invitamos el café ahora. Te escribimos solo por beneficios y vinos exclusivos — nada de spam.
      </p>
      <input
        value={nombre}
        onChange={(e) => setNombre(e.target.value)}
        placeholder="Tu nombre (opcional)"
        className="w-full rounded-lg border border-line bg-screen p-2.5 text-sm mb-2 placeholder:text-faint"
      />
      <input
        value={telefono}
        onChange={(e) => setTelefono(e.target.value)}
        type="tel"
        inputMode="tel"
        placeholder="WhatsApp con código de país (ej: 54937…)"
        className="w-full rounded-lg border border-line bg-screen p-2.5 text-sm mb-3 font-mono placeholder:text-faint"
      />
      <div className="flex gap-2">
        <button
          onClick={canjear}
          disabled={estado === "enviando" || telefono.replace(/\D/g, "").length < 8}
          className="flex-1 py-3 rounded-xl bg-gradient-to-br from-accent to-accent-2 text-[#1a1206] font-bold text-sm disabled:opacity-50"
        >
          {estado === "enviando" ? "Canjeando…" : "Canjear mi café"}
        </button>
        <button onClick={() => setAbierto(false)} className="px-3 rounded-xl border border-line text-faint text-xs">
          Ahora no
        </button>
      </div>
      {error && <p className="text-loss text-xs mt-2">{error}</p>}
    </div>
  );
}
