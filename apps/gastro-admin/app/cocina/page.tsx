"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";

type Plato = {
  id: string;
  nombre: string;
  cantidad: number;
  estado: "pendiente" | "en_coccion";
  mesaNumero: number | null;
  sector: string | null;
  minutos: number;
  objetivo: number | null;
  color: "verde" | "amarillo" | "rojo";
};
type Tablero = { pendientes: Plato[]; listos: Plato[] };

const COLOR_CARD = {
  verde: "border-line bg-card",
  amarillo: "border-warn/60 bg-warn/10",
  rojo: "border-loss/70 bg-loss/10",
};

// Beep con Web Audio (sin archivo de sonido): los navegadores exigen un toque
// del usuario antes de poder sonar, por eso el botón "Activar alarma".
function useAlarmaSonora(hayAlarma: boolean, activo: boolean) {
  const ctxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    if (!activo || !hayAlarma) return;
    const sonar = () => {
      const ctx = ctxRef.current;
      if (!ctx) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "square";
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.16, ctx.currentTime);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.3);
      setTimeout(() => {
        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();
        osc2.type = "square";
        osc2.frequency.value = 1046;
        gain2.gain.setValueAtTime(0.16, ctx.currentTime);
        osc2.connect(gain2).connect(ctx.destination);
        osc2.start();
        osc2.stop(ctx.currentTime + 0.3);
      }, 350);
    };
    sonar();
    const t = setInterval(sonar, 12_000);
    return () => clearInterval(t);
  }, [hayAlarma, activo]);

  return ctxRef;
}

export default function CocinaPage() {
  const [tablero, setTablero] = useState<Tablero>({ pendientes: [], listos: [] });
  const [cargando, setCargando] = useState(true);
  const [sonidoActivo, setSonidoActivo] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null);

  const hayRojo = tablero.pendientes.some((p) => p.color === "rojo");
  const ctxRef = useAlarmaSonora(hayRojo, sonidoActivo);

  async function cargar() {
    try {
      setTablero(await api("/admin/cocina/tablero"));
    } finally {
      setCargando(false);
    }
  }

  useEffect(() => {
    cargar();
    const t = setInterval(cargar, 5000);
    return () => clearInterval(t);
  }, []);

  function activarSonido() {
    if (!ctxRef.current) ctxRef.current = new AudioContext();
    else ctxRef.current.resume();
    setSonidoActivo(true);
  }

  async function accion(id: string, paso: "empezar" | "listo" | "entregado") {
    setOcupado(id);
    try {
      await api(`/admin/cocina/items/${id}/${paso}`, { method: "POST" });
      await cargar();
    } finally {
      setOcupado(null);
    }
  }

  if (cargando) return <p className="text-faint text-sm">Cargando…</p>;

  return (
    <div>
      <div className="flex items-baseline justify-between mb-5">
        <h1 className="display text-xl font-bold">Tablero de cocina</h1>
        {!sonidoActivo && (
          <button onClick={activarSonido} className="text-xs font-bold px-3 py-1.5 rounded-lg bg-accent/15 text-accent">
            🔔 Activar alarma
          </button>
        )}
      </div>

      {tablero.pendientes.length === 0 ? (
        <p className="text-faint text-sm mb-8">No hay platos en cocina ahora.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-8">
          {tablero.pendientes.map((p) => (
            <div key={p.id} className={`rounded-xl border p-3.5 ${COLOR_CARD[p.color]} ${p.color === "rojo" ? "animate-pulse" : ""}`}>
              <div className="flex justify-between items-start gap-2 mb-2">
                <span className="font-bold text-sm leading-tight">{p.nombre}{p.cantidad > 1 ? ` ×${p.cantidad}` : ""}</span>
              </div>
              <p className="text-faint text-[10.5px] mb-2">
                Mesa {p.mesaNumero}{p.sector ? ` · ${p.sector}` : ""}
              </p>
              <p className="font-mono text-xl font-bold tabular-nums leading-none mb-1">
                {p.minutos}′{p.objetivo ? <span className="text-faint text-xs font-normal"> / {p.objetivo}′</span> : ""}
              </p>
              <p className="text-[10.5px] text-dim mb-3">
                {p.estado === "pendiente" ? "esperando para arrancar" : p.color === "rojo" ? "¡se pasó del punto!" : "en la parrilla"}
              </p>
              <button
                onClick={() => accion(p.id, p.estado === "pendiente" ? "empezar" : "listo")}
                disabled={ocupado === p.id}
                className="w-full py-2.5 rounded-lg bg-gradient-to-br from-accent to-accent-2 text-[#1a1206] font-bold text-xs disabled:opacity-60"
              >
                {p.estado === "pendiente" ? "Empezar" : "Listo"}
              </button>
            </div>
          ))}
        </div>
      )}

      {tablero.listos.length > 0 && (
        <div>
          <h2 className="text-xs font-bold text-dim uppercase tracking-wide mb-2.5">Listos para retirar</h2>
          <div className="flex flex-col gap-2">
            {tablero.listos.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-3 rounded-lg border border-good/40 bg-good/10 p-2.5">
                <span className="text-sm font-medium">
                  {p.nombre}{p.cantidad > 1 ? ` ×${p.cantidad}` : ""} · Mesa {p.mesaNumero}
                </span>
                <button
                  onClick={() => accion(p.id, "entregado")}
                  disabled={ocupado === p.id}
                  className="text-xs font-bold px-3 py-1.5 rounded-lg border border-good/40 text-good"
                >
                  Entregar
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
