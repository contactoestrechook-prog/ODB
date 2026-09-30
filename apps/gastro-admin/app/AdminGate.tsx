"use client";

import { useEffect, useState } from "react";
import { getAdminKey, setAdminKey, api } from "./lib/api";

// Fase 1: un solo usuario (Damián/encargado) — pide la clave una vez, la
// guarda en el navegador y listo. Nada de usuarios/roles todavía.
export function AdminGate({ children }: { children: React.ReactNode }) {
  const [listo, setListo] = useState(false);
  const [autenticado, setAutenticado] = useState(false);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [verificando, setVerificando] = useState(false);

  useEffect(() => {
    const guardada = getAdminKey();
    if (!guardada) {
      setListo(true);
      return;
    }
    (async () => {
      try {
        await api("/admin/mesas");
        setAutenticado(true);
      } catch {
        // clave vencida/incorrecta: api() ya la limpió
      } finally {
        setListo(true);
      }
    })();
  }, []);

  async function entrar() {
    setVerificando(true);
    setError(null);
    setAdminKey(input.trim());
    try {
      await api("/admin/mesas");
      setAutenticado(true);
    } catch {
      setError("Clave incorrecta.");
    } finally {
      setVerificando(false);
    }
  }

  if (!listo) return null;

  if (!autenticado) {
    return (
      <div className="min-h-screen grid place-items-center px-5">
        <div className="w-full max-w-xs text-center">
          <div className="w-12 h-12 rounded-xl mx-auto mb-5 bg-gradient-to-br from-accent to-accent-2 grid place-items-center">
            <span className="display text-xl font-bold text-[#1a1206]">GC</span>
          </div>
          <h1 className="display text-lg font-bold mb-1">Panel de Gran Caminito</h1>
          <p className="text-faint text-xs mb-6">Ingresá tu clave de acceso</p>
          <input
            type="password"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && entrar()}
            placeholder="Clave"
            className="w-full rounded-xl border border-line bg-card p-3 text-sm text-center mb-3"
          />
          <button
            onClick={entrar}
            disabled={verificando || !input}
            className="w-full font-semibold text-sm py-3 rounded-xl bg-gradient-to-br from-accent to-accent-2 text-[#1a1206] disabled:opacity-60"
          >
            {verificando ? "Verificando…" : "Entrar"}
          </button>
          {error && <p className="text-loss text-xs mt-3">{error}</p>}
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
