"use client";

import { useEffect, useState } from "react";
import { api } from "./lib/api";

type Resumen = { total: number; contento: number; neutral: number; molesto: number; tasaSatisfaccion: number | null };
type Alerta = {
  id: string;
  sentimiento: string;
  creado_en: string;
  mesa: { numero: number; sector: string | null };
  opinion: { comentario: string | null };
};
type MetricasDia = {
  ciclosCerrados: number;
  tiempoMesaProm: number | null;
  tiempoMuertoProm: number | null;
  ticketProm: number | null;
  ingresoTotal: number;
  cubiertosTotal: number;
  revPash: number | null;
  tasaSatisfaccion: number | null;
};
type ResumenAnalista = { fecha: string; metricas: MetricasDia; insight: string };
type Ahora = {
  ocupadas: number;
  totalMesas: number;
  ocupacionPct: number;
  llamadosPendientes: number;
  mesasEnRiesgo: number;
  cubiertosHoy: number;
  cobradoHoy: number;
  mesasCerradasHoy: number;
};
type MetricaCocina = {
  nombre: string;
  platos: number;
  objetivoMin: number | null;
  realMin: number | null;
  esperaMin: number | null;
  desvioMin: number | null;
};

const formatoPesos = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

export default function ResumenPage() {
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [alertas, setAlertas] = useState<Alerta[]>([]);
  const [analista, setAnalista] = useState<ResumenAnalista | null>(null);
  const [ahora, setAhora] = useState<Ahora | null>(null);
  const [cocina, setCocina] = useState<MetricaCocina[]>([]);
  const [cargando, setCargando] = useState(true);

  async function cargar() {
    const [r, a, an, ah, co] = await Promise.all([
      api("/admin/termometro/resumen"),
      api("/admin/alertas"),
      api("/admin/analista/resumen"),
      api("/admin/analista/ahora"),
      api("/admin/cocina/metricas"),
    ]);
    setResumen(r);
    setAlertas(a);
    setAnalista(an);
    setAhora(ah);
    setCocina(co);
    setCargando(false);
  }

  useEffect(() => {
    cargar();
    // el bloque AHORA late en vivo
    const t = setInterval(() => api("/admin/analista/ahora").then(setAhora).catch(() => {}), 10_000);
    return () => clearInterval(t);
  }, []);

  async function resolver(id: string) {
    await api(`/admin/alertas/${id}/resolver`, { method: "POST" });
    setAlertas((prev) => prev.filter((al) => al.id !== id));
  }

  if (cargando) return <p className="text-faint text-sm">Cargando…</p>;

  const m = analista?.metricas;

  return (
    <div className="flex flex-col gap-6">
      {ahora && (
        <div>
          <div className="flex items-baseline justify-between mb-3">
            <h1 className="display text-xl font-bold">Ahora en el salón</h1>
            <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-loss">
              <span className="w-1.5 h-1.5 rounded-full bg-loss animate-pulse" /> en vivo
            </span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Ocupación" valor={`${ahora.ocupadas}/${ahora.totalMesas} · ${ahora.ocupacionPct}%`} />
            <Stat label="Cobrado hoy" valor={formatoPesos.format(ahora.cobradoHoy)} color="good" />
            <Stat
              label="Mesas en riesgo"
              valor={ahora.mesasEnRiesgo}
              color={ahora.mesasEnRiesgo > 0 ? "loss" : "good"}
            />
            <Stat
              label="Llamados sin atender"
              valor={ahora.llamadosPendientes}
              color={ahora.llamadosPendientes > 0 ? "loss" : undefined}
            />
          </div>
          {(ahora.mesasEnRiesgo > 0 || ahora.llamadosPendientes > 0) && (
            <a href="/piso-vivo" className="block text-center text-xs font-bold text-accent mt-2.5">
              Ver el Piso Vivo →
            </a>
          )}
        </div>
      )}

      <div>
        <p className="text-[10px] tracking-[0.14em] uppercase text-accent font-bold mb-1">El Analista</p>
        <h1 className="display text-xl font-bold mb-4">
          Resumen de ayer{analista?.fecha ? ` · ${new Date(analista.fecha + "T12:00:00").toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "short" })}` : ""}
        </h1>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <Stat label="RevPASH" valor={m?.revPash != null ? formatoPesos.format(m.revPash) : "—"} />
          <Stat label="Tiempo de mesa" valor={m?.tiempoMesaProm != null ? `${m.tiempoMesaProm}′` : "—"} />
          <Stat label="Tiempo muerto" valor={m?.tiempoMuertoProm != null ? `${m.tiempoMuertoProm}′` : "—"} color={m?.tiempoMuertoProm && m.tiempoMuertoProm > 5 ? "loss" : undefined} />
          <Stat label="Ticket medio" valor={m?.ticketProm != null ? formatoPesos.format(m.ticketProm) : "—"} />
        </div>
        {analista?.insight && (
          <div className="rounded-xl border border-accent/30 bg-gradient-to-b from-accent/10 to-transparent p-4">
            <p className="text-[10px] tracking-[0.1em] uppercase text-accent font-bold mb-1.5">La IA encontró algo</p>
            <p className="text-sm text-ink">{analista.insight}</p>
          </div>
        )}
      </div>

      <div>
        <h1 className="display text-xl font-bold mb-4">Últimos 30 días</h1>
        <div className="grid grid-cols-2 gap-3">
          <Stat label="Opiniones" valor={resumen?.total ?? 0} />
          <Stat label="Satisfacción" valor={resumen?.tasaSatisfaccion != null ? `${resumen.tasaSatisfaccion}%` : "—"} color="good" />
          <Stat label="Contentos" valor={resumen?.contento ?? 0} color="good" />
          <Stat label="Molestos" valor={resumen?.molesto ?? 0} color="loss" />
        </div>
      </div>

      {cocina.length > 0 && (
        <div>
          <h2 className="display text-lg font-bold mb-1">Producción de cocina</h2>
          <p className="text-faint text-xs mb-3">Tiempo real vs. objetivo · últimos 30 días. El desvío dice si hay que corregir el objetivo o la parrilla.</p>
          <div className="rounded-xl border border-line bg-card overflow-hidden">
            {cocina.slice(0, 8).map((c, i) => (
              <div key={c.nombre} className={`flex items-center justify-between gap-3 px-4 py-2.5 ${i > 0 ? "border-t border-line" : ""}`}>
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{c.nombre}</p>
                  <p className="text-faint text-[10.5px]">{c.platos} platos · espera {c.esperaMin ?? "—"}′</p>
                </div>
                <div className="text-right whitespace-nowrap">
                  <p className="font-mono text-sm font-bold tabular-nums">
                    {c.realMin ?? "—"}′ <span className="text-faint font-normal">/ {c.objetivoMin ?? "—"}′</span>
                  </p>
                  {c.desvioMin != null && (
                    <p className={`text-[10.5px] font-bold ${c.desvioMin > 2 ? "text-loss" : c.desvioMin < -2 ? "text-good" : "text-faint"}`}>
                      {c.desvioMin > 0 ? `+${c.desvioMin}′ se pasa` : c.desvioMin < 0 ? `${c.desvioMin}′ más rápido` : "en punto"}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <h2 className="display text-lg font-bold mb-3">Alertas pendientes</h2>
        {alertas.length === 0 && <p className="text-faint text-sm">No hay alertas sin atender. 🎉</p>}
        <div className="flex flex-col gap-3">
          {alertas.map((al) => (
            <div key={al.id} className="rounded-xl border border-line bg-card p-4">
              <div className="flex justify-between items-start gap-3">
                <div>
                  <p className="font-semibold text-sm">
                    Mesa {al.mesa?.numero}{al.mesa?.sector ? ` · ${al.mesa.sector}` : ""}{" "}
                    <span className={al.sentimiento === "molesto" ? "text-loss" : "text-warn"}>
                      · {al.sentimiento}
                    </span>
                  </p>
                  {al.opinion?.comentario && (
                    <p className="text-dim text-sm mt-1">&ldquo;{al.opinion.comentario}&rdquo;</p>
                  )}
                  <p className="text-faint text-xs mt-1">{new Date(al.creado_en).toLocaleString("es-AR")}</p>
                </div>
                <button
                  onClick={() => resolver(al.id)}
                  className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-line whitespace-nowrap"
                >
                  Marcar resuelta
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, valor, color }: { label: string; valor: string | number; color?: "good" | "loss" }) {
  return (
    <div className="rounded-xl border border-line bg-card p-3">
      <p className="text-[10.5px] text-faint font-semibold uppercase tracking-wide">{label}</p>
      <p className={`text-xl font-bold mt-1 font-mono tabular-nums ${color === "good" ? "text-good" : color === "loss" ? "text-loss" : ""}`}>
        {valor}
      </p>
    </div>
  );
}
