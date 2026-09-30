"use client";

import { useEffect, useState } from "react";
import { api } from "../lib/api";

type Grupo = {
  id: string;
  nombre: string;
  telefono: string;
  personas: number;
  idioma: "es" | "pt" | "en";
  estado: "esperando" | "avisado";
  creado_en: string;
};
type Resumen = { total: number; abandonos: number; tasaAbandono: number | null };

const BANDERA: Record<string, string> = { es: "🇦🇷", pt: "🇧🇷", en: "🇬🇧" };

function minutosDesde(iso: string) {
  return Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
}

export default function EsperaPage() {
  const [grupos, setGrupos] = useState<Grupo[]>([]);
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [cargando, setCargando] = useState(true);
  const [nuevo, setNuevo] = useState(false);
  const [form, setForm] = useState({ nombre: "", telefono: "", personas: 2, idioma: "es" as "es" | "pt" | "en" });
  const [ocupado, setOcupado] = useState<string | null>(null);

  async function cargar() {
    const [g, r] = await Promise.all([api("/admin/espera"), api("/admin/espera/resumen")]);
    setGrupos(g);
    setResumen(r);
    setCargando(false);
  }

  useEffect(() => {
    cargar();
    const t = setInterval(cargar, 8000);
    return () => clearInterval(t);
  }, []);

  async function agregar() {
    if (!form.nombre || !form.telefono) return;
    await api("/admin/espera", { method: "POST", body: JSON.stringify(form) });
    setForm({ nombre: "", telefono: "", personas: 2, idioma: "es" });
    setNuevo(false);
    await cargar();
  }

  async function avisar(id: string) {
    setOcupado(id);
    try {
      const res = await api(`/admin/espera/${id}/avisar`, { method: "POST" });
      window.open(res.waLink, "_blank");
      await cargar();
    } finally {
      setOcupado(null);
    }
  }

  async function resolver(id: string, accion: "sentar" | "abandono") {
    setOcupado(id);
    try {
      await api(`/admin/espera/${id}/${accion}`, { method: "POST" });
      await cargar();
    } finally {
      setOcupado(null);
    }
  }

  if (cargando) return <p className="text-faint text-sm">Cargando…</p>;

  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <h1 className="display text-xl font-bold">Lista de espera</h1>
        {resumen && (
          <span className="text-faint text-xs">
            hoy: {resumen.total} · abandono {resumen.tasaAbandono != null ? `${resumen.tasaAbandono}%` : "—"}
          </span>
        )}
      </div>
      <p className="text-faint text-xs mb-5">La demanda que hoy se va caminando por la vereda, medida.</p>

      {nuevo ? (
        <div className="rounded-xl border border-line bg-card p-4 mb-4 flex flex-col gap-3">
          <input
            placeholder="Nombre"
            value={form.nombre}
            onChange={(e) => setForm({ ...form, nombre: e.target.value })}
            className="rounded-lg border border-line bg-card-2 p-2.5 text-sm"
          />
          <input
            placeholder="Teléfono (con código de país, ej 5493757123456)"
            value={form.telefono}
            onChange={(e) => setForm({ ...form, telefono: e.target.value })}
            className="rounded-lg border border-line bg-card-2 p-2.5 text-sm font-mono"
          />
          <div className="flex gap-2">
            <input
              type="number"
              min={1}
              value={form.personas}
              onChange={(e) => setForm({ ...form, personas: Number(e.target.value) })}
              className="w-20 rounded-lg border border-line bg-card-2 p-2.5 text-sm font-mono"
            />
            {(["es", "pt", "en"] as const).map((idi) => (
              <button
                key={idi}
                onClick={() => setForm({ ...form, idioma: idi })}
                className={`flex-1 rounded-lg border text-sm font-bold ${form.idioma === idi ? "border-accent bg-card-2 text-accent" : "border-line text-faint"}`}
              >
                {BANDERA[idi]} {idi.toUpperCase()}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <button onClick={agregar} className="flex-1 py-3 rounded-xl bg-gradient-to-br from-accent to-accent-2 text-[#1a1206] font-bold text-sm">
              Agregar
            </button>
            <button onClick={() => setNuevo(false)} className="px-4 rounded-xl border border-line text-faint text-sm">
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <button onClick={() => setNuevo(true)} className="w-full py-3 rounded-xl border border-dashed border-line text-dim text-sm font-semibold mb-4">
          + Anotar grupo
        </button>
      )}

      {grupos.length === 0 && <p className="text-faint text-sm">No hay nadie esperando ahora.</p>}

      <div className="flex flex-col gap-3">
        {grupos.map((g) => (
          <div key={g.id} className="rounded-xl border border-line bg-card p-4">
            <div className="flex justify-between items-start gap-3 mb-3">
              <div>
                <p className="font-semibold text-sm">
                  {BANDERA[g.idioma]} {g.nombre} · {g.personas}p
                </p>
                <p className="text-faint text-xs mt-0.5">
                  esperando {minutosDesde(g.creado_en)}′ {g.estado === "avisado" && "· ya avisado"}
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => avisar(g.id)}
                disabled={ocupado === g.id}
                className="flex-1 py-2.5 rounded-lg bg-gradient-to-br from-accent to-accent-2 text-[#1a1206] font-bold text-xs disabled:opacity-60"
              >
                {g.estado === "avisado" ? "Avisar de nuevo" : "Avisar por WhatsApp"}
              </button>
              <button onClick={() => resolver(g.id, "sentar")} disabled={ocupado === g.id} className="px-3 rounded-lg border border-good/40 text-good text-xs font-semibold">
                Sentó
              </button>
              <button onClick={() => resolver(g.id, "abandono")} disabled={ocupado === g.id} className="px-3 rounded-lg border border-loss/40 text-loss text-xs font-semibold">
                Se fue
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
