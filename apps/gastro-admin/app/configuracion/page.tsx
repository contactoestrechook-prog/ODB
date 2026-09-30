"use client";

import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { Mozo } from "../lib/piso";

type Config = { nombre_restaurante: string; capacidad_asientos: number; horas_servicio_dia: number };

export default function ConfiguracionPage() {
  const [config, setConfig] = useState<Config | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [guardado, setGuardado] = useState(false);
  const [mozos, setMozos] = useState<Mozo[]>([]);
  const [nuevoMozo, setNuevoMozo] = useState("");

  async function cargarMozos() {
    setMozos(await api("/admin/mozos"));
  }

  useEffect(() => {
    api("/admin/configuracion").then(setConfig);
    cargarMozos();
  }, []);

  async function agregarMozo() {
    if (!nuevoMozo.trim()) return;
    await api("/admin/mozos", { method: "POST", body: JSON.stringify({ nombre: nuevoMozo.trim() }) });
    setNuevoMozo("");
    cargarMozos();
  }

  async function toggleMozo(mz: Mozo) {
    await api(`/admin/mozos/${mz.id}`, { method: "PUT", body: JSON.stringify({ activo: !mz.activo }) });
    cargarMozos();
  }

  async function guardar() {
    if (!config) return;
    setGuardando(true);
    setGuardado(false);
    try {
      await api("/admin/configuracion", {
        method: "PUT",
        body: JSON.stringify({
          nombreRestaurante: config.nombre_restaurante,
          capacidadAsientos: Number(config.capacidad_asientos),
          horasServicioDia: Number(config.horas_servicio_dia),
        }),
      });
      setGuardado(true);
    } finally {
      setGuardando(false);
    }
  }

  if (!config) return <p className="text-faint text-sm">Cargando…</p>;

  return (
    <div className="max-w-sm">
      <h1 className="display text-xl font-bold mb-2">Configuración</h1>
      <p className="text-faint text-xs mb-6">
        Estos dos números son la base del cálculo de RevPASH. Ajustalos a la realidad de Gran Caminito
        (asientos totales del salón + horas reales de servicio por día) para que el número tenga sentido.
      </p>

      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-dim">Nombre del restaurante</span>
          <input
            value={config.nombre_restaurante}
            onChange={(e) => setConfig({ ...config, nombre_restaurante: e.target.value })}
            className="rounded-lg border border-line bg-card p-2.5 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-dim">Capacidad total de asientos</span>
          <input
            type="number"
            value={config.capacidad_asientos}
            onChange={(e) => setConfig({ ...config, capacidad_asientos: Number(e.target.value) })}
            className="rounded-lg border border-line bg-card p-2.5 text-sm font-mono"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-dim">Horas de servicio por día</span>
          <input
            type="number"
            step="0.5"
            value={config.horas_servicio_dia}
            onChange={(e) => setConfig({ ...config, horas_servicio_dia: Number(e.target.value) })}
            className="rounded-lg border border-line bg-card p-2.5 text-sm font-mono"
          />
        </label>

        <button
          onClick={guardar}
          disabled={guardando}
          className="font-semibold text-sm py-3 rounded-xl bg-gradient-to-br from-accent to-accent-2 text-[#1a1206] disabled:opacity-60"
        >
          {guardando ? "Guardando…" : "Guardar"}
        </button>
        {guardado && <p className="text-good text-xs text-center">✓ Guardado</p>}
      </div>

      <div className="mt-10">
        <h2 className="display text-lg font-bold mb-2">Mozos</h2>
        <p className="text-faint text-xs mb-4">
          El encargado del salón elige de esta lista al asignar una mesa; cada mozo elige su nombre una vez en /mozo.
        </p>
        <div className="flex gap-2 mb-3">
          <input
            value={nuevoMozo}
            onChange={(e) => setNuevoMozo(e.target.value)}
            placeholder="Nombre del mozo"
            className="flex-1 rounded-lg border border-line bg-card p-2.5 text-sm"
          />
          <button onClick={agregarMozo} className="text-xs font-semibold px-3 rounded-lg border border-line">Agregar</button>
        </div>
        <div className="flex flex-col gap-2">
          {mozos.map((mz) => (
            <div key={mz.id} className={`flex items-center justify-between rounded-lg border border-line bg-card p-2.5 ${!mz.activo ? "opacity-50" : ""}`}>
              <span className="text-sm font-medium">{mz.nombre}</span>
              <button onClick={() => toggleMozo(mz)} className="text-xs px-2 py-1 rounded-lg border border-line">
                {mz.activo ? "Desactivar" : "Activar"}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
