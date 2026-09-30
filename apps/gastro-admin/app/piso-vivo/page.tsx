"use client";

import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { ETIQUETA_ESTADO, type MesaPiso } from "../lib/piso";

const COLOR_BORDE = { verde: "border-good/50 bg-good/10", amarillo: "border-warn/50 bg-warn/10", rojo: "border-loss/60 bg-loss/10" };
const COLOR_PUNTO = { verde: "bg-good", amarillo: "bg-warn", rojo: "bg-loss" };

type Director = { ocupacion: number; dosPorUnoActivo: boolean; sugerencias: { tipo: string; mensaje: string }[] };

export default function PisoVivoPage() {
  const [mesas, setMesas] = useState<MesaPiso[]>([]);
  const [director, setDirector] = useState<Director | null>(null);
  const [cargando, setCargando] = useState(true);
  const [cambiando2x1, setCambiando2x1] = useState(false);

  async function cargar() {
    try {
      const [m, d] = await Promise.all([api("/admin/piso-vivo"), api("/admin/director/sugerencias")]);
      setMesas(m);
      setDirector(d);
    } finally {
      setCargando(false);
    }
  }

  useEffect(() => {
    cargar();
    // en vivo de verdad: refresca solo cada pocos segundos
    const t = setInterval(cargar, 5000);
    return () => clearInterval(t);
  }, []);

  async function toggle2x1() {
    if (!director) return;
    setCambiando2x1(true);
    try {
      await api("/admin/configuracion", { method: "PUT", body: JSON.stringify({ dosPorUnoActivo: !director.dosPorUnoActivo }) });
      await cargar();
    } finally {
      setCambiando2x1(false);
    }
  }

  if (cargando) return <p className="text-faint text-sm">Cargando…</p>;

  const ocupadas = mesas.filter((m) => m.estado !== "libre").length;

  return (
    <div>
      <div className="flex items-baseline justify-between mb-3">
        <h1 className="display text-xl font-bold">El Piso Vivo</h1>
        <span className="text-faint text-xs">{ocupadas}/{mesas.length} ocupadas · {director?.ocupacion}%</span>
      </div>

      {director && (
        <div className="rounded-xl border border-line bg-card p-3.5 mb-5">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-semibold text-dim">2x1</span>
            <button
              onClick={toggle2x1}
              disabled={cambiando2x1}
              className={`text-xs font-bold px-3 py-1.5 rounded-lg ${director.dosPorUnoActivo ? "bg-good/15 text-good" : "bg-card-2 text-faint"}`}
            >
              {director.dosPorUnoActivo ? "Activado" : "Apagado"}
            </button>
          </div>
          {director.sugerencias.map((s, i) => (
            <div key={i} className="mt-2.5 pt-2.5 border-t border-line">
              <p className="text-[10px] tracking-[0.1em] uppercase text-accent font-bold mb-1">El Director sugiere</p>
              <p className="text-sm">{s.mensaje}</p>
            </div>
          ))}
        </div>
      )}

      {Object.entries(agruparPorSector(mesas)).map(([sector, mesasSector]) => {
        const ocupadasSector = mesasSector.filter((m) => m.estado !== "libre").length;
        return (
          <div key={sector} className="mb-6">
            <div className="flex items-baseline justify-between mb-2.5">
              <h2 className="text-xs font-bold text-dim uppercase tracking-wide">{sector}</h2>
              <span className="text-faint text-[11px]">{ocupadasSector}/{mesasSector.length}</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {mesasSector.map((m) => (
                <div key={m.mesaId} className={`rounded-xl border p-3 ${m.estado === "libre" ? "border-line opacity-60" : COLOR_BORDE[m.color ?? "verde"]}`}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold text-sm">M{m.numero}</span>
                    <div className="flex items-center gap-1">
                      {m.llamadoHaceMin != null && <span className="text-[10px]">🔔</span>}
                      {m.estado !== "libre" && <span className={`w-2 h-2 rounded-full ${COLOR_PUNTO[m.color ?? "verde"]}`} />}
                    </div>
                  </div>
                  {m.estado === "libre" ? (
                    <p className="text-faint text-xs">Libre</p>
                  ) : (
                    <>
                      <p className="font-mono text-lg font-bold tabular-nums leading-none">{m.minutosTotal}′</p>
                      <p className="text-[11px] text-dim mt-1">{ETIQUETA_ESTADO[m.estado]}</p>
                      <p className="text-faint text-[10.5px] mt-0.5">
                        {m.mozoNombre ?? "sin mozo"}{m.cubiertos ? ` · ${m.cubiertos}p` : ""}
                      </p>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function agruparPorSector(mesas: MesaPiso[]): Record<string, MesaPiso[]> {
  const grupos: Record<string, MesaPiso[]> = {};
  for (const m of mesas) {
    const clave = m.sector ?? "Sin sector";
    (grupos[clave] ??= []).push(m);
  }
  return grupos;
}
