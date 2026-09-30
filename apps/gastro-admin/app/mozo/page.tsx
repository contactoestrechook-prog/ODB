"use client";

import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { ETIQUETA_ESTADO, ETIQUETA_SIGUIENTE, siguienteEstado, type MesaPiso, type Mozo } from "../lib/piso";
import { ComandaPicker } from "./ComandaPicker";

const COLOR_BORDE = { verde: "border-good/50", amarillo: "border-warn/60", rojo: "border-loss/70" };
const MOZO_KEY = "gc_mozo_id";

// PWA del mozo: 3-4 toques, nada de escribir. El encargado del salón (ver
// /encargado) es quien sienta y asigna la mesa — acá el mozo solo ve y
// trabaja SU cola, ordenada por orden de llegada (más viejo primero), con
// los llamados desde la mesa saltando al tope.
export default function MozoPage() {
  const [mesas, setMesas] = useState<MesaPiso[]>([]);
  const [mozos, setMozos] = useState<Mozo[]>([]);
  const [mozoId, setMozoId] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [cobrandoId, setCobrandoId] = useState<string | null>(null);
  const [monto, setMonto] = useState("");
  const [comandandoId, setComandandoId] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);

  async function cargar() {
    const [m, mz] = await Promise.all([api("/admin/piso-vivo"), api("/admin/mozos")]);
    setMesas(m);
    setMozos(mz.filter((x: Mozo) => x.activo));
    setCargando(false);
  }

  useEffect(() => {
    cargar();
    setMozoId(window.localStorage.getItem(MOZO_KEY));
    const t = setInterval(cargar, 5000);
    return () => clearInterval(t);
  }, []);

  function elegirMozo(id: string) {
    setMozoId(id);
    window.localStorage.setItem(MOZO_KEY, id);
  }

  async function avanzar(mesaId: string, montoCobrado?: number) {
    setOcupado(mesaId);
    try {
      await api(`/admin/mesas/${mesaId}/avanzar`, { method: "POST", body: JSON.stringify({ monto: montoCobrado }) });
      setCobrandoId(null);
      setMonto("");
      await cargar();
    } finally {
      setOcupado(null);
    }
  }

  async function confirmarComanda(mesaId: string, items: { itemId: string; cantidad: number }[]) {
    await api(`/admin/mesas/${mesaId}/comanda`, { method: "POST", body: JSON.stringify({ items }) });
    setComandandoId(null);
    await cargar();
  }

  async function atenderLlamado(mesaId: string) {
    setOcupado(mesaId);
    try {
      await api(`/admin/mesas/${mesaId}/llamado-atendido`, { method: "POST" });
      await cargar();
    } finally {
      setOcupado(null);
    }
  }

  // "Pagó" pide el monto (el único toque que implica escribir, y es
  // salteable). "Tomé la comanda" abre el picker de platos.
  function tocarSiguiente(m: MesaPiso) {
    const sig = siguienteEstado(m.estado);
    if (sig === "pago") setCobrandoId(m.mesaId);
    else if (sig === "comanda_tomada") setComandandoId(m.mesaId);
    else avanzar(m.mesaId);
  }

  if (cargando) return <p className="text-faint text-sm">Cargando…</p>;

  // Quién sos: se elige una vez y queda guardado en el teléfono.
  if (!mozoId) {
    return (
      <div>
        <h1 className="display text-xl font-bold mb-4">¿Quién sos?</h1>
        {mozos.length === 0 ? (
          <p className="text-faint text-sm">Todavía no hay mozos cargados — pedile al encargado que los agregue en Configuración.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {mozos.map((mz) => (
              <button key={mz.id} onClick={() => elegirMozo(mz.id)} className="py-3.5 rounded-xl border border-line bg-card font-semibold text-sm">
                {mz.nombre}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  const mesaComandando = mesas.find((m) => m.mesaId === comandandoId);

  // La cola: mis mesas, llamados primero, y dentro de cada grupo la más
  // vieja primero (orden de llegada = a quién atender antes).
  const misMesas = mesas
    .filter((m) => m.mozoId === mozoId)
    .sort((a, b) => {
      const aLlamado = a.llamadoHaceMin != null;
      const bLlamado = b.llamadoHaceMin != null;
      if (aLlamado !== bLlamado) return aLlamado ? -1 : 1;
      return (b.minutosTotal ?? 0) - (a.minutosTotal ?? 0);
    });

  return (
    <div>
      {mesaComandando && (
        <ComandaPicker
          mesaNumero={mesaComandando.numero}
          onCerrar={() => setComandandoId(null)}
          onConfirmar={(items) => confirmarComanda(mesaComandando.mesaId, items)}
        />
      )}

      <div className="flex items-baseline justify-between mb-4">
        <h1 className="display text-xl font-bold">Mi cola</h1>
        <button onClick={() => setMozoId(null)} className="text-faint text-xs font-semibold">
          {mozos.find((m) => m.id === mozoId)?.nombre} · cambiar
        </button>
      </div>

      {misMesas.length === 0 && <p className="text-faint text-sm">No tenés mesas asignadas todavía.</p>}

      <div className="flex flex-col gap-3">
        {misMesas.map((m, i) => (
          <div key={m.mesaId} className={`rounded-2xl border-2 p-4 ${m.llamadoHaceMin != null ? "border-accent" : COLOR_BORDE[m.color ?? "verde"]}`}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-card-2 text-[10px] font-bold flex items-center justify-center text-faint">{i + 1}</span>
                <span className="font-bold text-lg">Mesa {m.numero}</span>
              </div>
              {m.sector && <span className="text-faint text-xs">{m.sector}</span>}
            </div>

            {m.llamadoHaceMin != null && (
              <button
                onClick={() => atenderLlamado(m.mesaId)}
                disabled={ocupado === m.mesaId}
                className="w-full py-2.5 mb-3 rounded-xl bg-accent/15 text-accent font-bold text-xs"
              >
                🔔 Te está llamando hace {m.llamadoHaceMin}′ — tocar para marcar atendido
              </button>
            )}

            <p className="text-dim text-sm mb-1">{ETIQUETA_ESTADO[m.estado]}</p>
            <p className="font-mono text-2xl font-bold tabular-nums mb-3">{m.minutosTotal}′</p>

            {cobrandoId === m.mesaId ? (
              <div>
                <input
                  type="number"
                  inputMode="numeric"
                  autoFocus
                  value={monto}
                  onChange={(e) => setMonto(e.target.value)}
                  placeholder="Monto total"
                  className="w-full rounded-xl border border-line bg-card-2 p-3 text-sm mb-2 text-center font-mono"
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => avanzar(m.mesaId, monto ? Number(monto) : undefined)}
                    disabled={ocupado === m.mesaId}
                    className="flex-1 py-3 rounded-xl bg-gradient-to-br from-accent to-accent-2 text-[#1a1206] font-bold text-sm"
                  >
                    Confirmar
                  </button>
                  <button
                    onClick={() => avanzar(m.mesaId)}
                    disabled={ocupado === m.mesaId}
                    className="py-3 px-3 rounded-xl border border-line text-faint text-xs"
                  >
                    Sin monto
                  </button>
                </div>
              </div>
            ) : (
              siguienteEstado(m.estado) && (
                <button
                  onClick={() => tocarSiguiente(m)}
                  disabled={ocupado === m.mesaId}
                  className="w-full py-4 rounded-xl bg-gradient-to-br from-accent to-accent-2 text-[#1a1206] font-bold text-sm disabled:opacity-60"
                >
                  {ocupado === m.mesaId ? "…" : ETIQUETA_SIGUIENTE[siguienteEstado(m.estado)!]}
                </button>
              )
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
