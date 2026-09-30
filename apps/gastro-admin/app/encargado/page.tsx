"use client";

import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { ETIQUETA_ESTADO, type MesaPiso, type Mozo } from "../lib/piso";

const COLOR_BORDE = { verde: "border-good/50 bg-good/10", amarillo: "border-warn/50 bg-warn/10", rojo: "border-loss/60 bg-loss/10" };

// El encargado del salón: ubica a la gente y decide quién la atiende. El
// mozo, una vez asignado, ya no elige mesa — solo trabaja su cola (ver /mozo).
export default function EncargadoPage() {
  const [mesas, setMesas] = useState<MesaPiso[]>([]);
  const [mozos, setMozos] = useState<Mozo[]>([]);
  const [cargando, setCargando] = useState(true);
  const [sentandoId, setSentandoId] = useState<string | null>(null);
  const [cubiertos, setCubiertos] = useState<number | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function cargar() {
    const [m, mz] = await Promise.all([api("/admin/piso-vivo"), api("/admin/mozos")]);
    setMesas(m);
    setMozos(mz.filter((x: Mozo) => x.activo));
    setCargando(false);
  }

  useEffect(() => {
    cargar();
    const t = setInterval(cargar, 6000);
    return () => clearInterval(t);
  }, []);

  function empezarSentar(mesaId: string) {
    setSentandoId(mesaId);
    setCubiertos(null);
  }

  function cancelar() {
    setSentandoId(null);
    setCubiertos(null);
  }

  async function confirmarConMozo(mozoId: string) {
    if (!sentandoId || cubiertos == null) return;
    setOcupado(true);
    try {
      await api(`/admin/mesas/${sentandoId}/abrir`, { method: "POST", body: JSON.stringify({ cubiertos, mozoId }) });
      cancelar();
      await cargar();
    } finally {
      setOcupado(false);
    }
  }

  if (cargando) return <p className="text-faint text-sm">Cargando…</p>;

  const grupos = agruparPorSector(mesas);

  return (
    <div>
      <h1 className="display text-xl font-bold mb-1">Encargado de salón</h1>
      <p className="text-faint text-xs mb-5">Ubicá a la gente y asignale un mozo.</p>

      {mozos.length === 0 && (
        <div className="rounded-xl border border-warn/40 bg-warn/10 p-3.5 mb-5">
          <p className="text-sm">Todavía no cargaste mozos. Agregalos en <b>Configuración</b> antes de poder asignar una mesa.</p>
        </div>
      )}

      {Object.entries(grupos).map(([sector, mesasSector]) => (
        <div key={sector} className="mb-6">
          <h2 className="text-xs font-bold text-dim uppercase tracking-wide mb-2.5">{sector}</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {mesasSector.map((m) => (
              <div key={m.mesaId} className={`rounded-xl border p-3 ${m.estado === "libre" ? "border-line" : COLOR_BORDE[m.color ?? "verde"]}`}>
                <div className="flex items-center justify-between mb-1">
                  <span className="font-bold text-sm">M{m.numero}</span>
                  {m.llamadoHaceMin != null && <span className="text-[10px] font-bold text-accent">🔔</span>}
                </div>

                {m.estado === "libre" ? (
                  sentandoId === m.mesaId ? (
                    cubiertos == null ? (
                      <div>
                        <p className="text-faint text-[10.5px] mb-1.5">¿Cuántos son?</p>
                        <div className="grid grid-cols-4 gap-1">
                          {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                            <button key={n} onClick={() => setCubiertos(n)} className="py-2 rounded-lg bg-card-2 font-bold text-xs">
                              {n}
                            </button>
                          ))}
                        </div>
                        <button onClick={cancelar} className="text-faint text-[10.5px] mt-1.5">Cancelar</button>
                      </div>
                    ) : (
                      <div>
                        <p className="text-faint text-[10.5px] mb-1.5">¿Quién la atiende?</p>
                        <div className="flex flex-col gap-1">
                          {mozos.map((mz) => (
                            <button
                              key={mz.id}
                              onClick={() => confirmarConMozo(mz.id)}
                              disabled={ocupado}
                              className="py-1.5 rounded-lg bg-card-2 font-semibold text-xs"
                            >
                              {mz.nombre}
                            </button>
                          ))}
                        </div>
                        <button onClick={cancelar} className="text-faint text-[10.5px] mt-1.5">Cancelar</button>
                      </div>
                    )
                  ) : (
                    <button
                      onClick={() => empezarSentar(m.mesaId)}
                      disabled={mozos.length === 0}
                      className="w-full py-2.5 rounded-lg bg-gradient-to-br from-accent to-accent-2 text-[#1a1206] font-bold text-xs disabled:opacity-40"
                    >
                      Sentar
                    </button>
                  )
                ) : (
                  <>
                    <p className="font-mono text-lg font-bold tabular-nums leading-none">{m.minutosTotal}′</p>
                    <p className="text-[11px] text-dim mt-1">{ETIQUETA_ESTADO[m.estado]}</p>
                    <p className="text-faint text-[10.5px] mt-0.5">{m.mozoNombre ?? "sin mozo"}{m.cubiertos ? ` · ${m.cubiertos}p` : ""}</p>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
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
