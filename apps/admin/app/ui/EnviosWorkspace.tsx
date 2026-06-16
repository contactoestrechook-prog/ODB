'use client';

import { useEffect, useState } from 'react';

const pesos = (n: any) => '$' + Math.round(Number(n) || 0).toLocaleString('es-AR');
const ESTADO_LABEL: Record<string, string> = { recibido: 'Recibido', pagado: 'Pagado', en_preparacion: 'En preparación', listo: 'Listo', en_camino: 'En camino', entregado: 'Entregado' };
const ESTADO_BADGE: Record<string, string> = { recibido: 'bg-amber-100 text-amber-800', pagado: 'bg-amber-100 text-amber-800', en_preparacion: 'bg-blue-100 text-blue-800', listo: 'bg-purple-100 text-purple-800', en_camino: 'bg-green-100 text-green-800', entregado: 'bg-black/10 text-black/60' };
const SIGUIENTE: Record<string, { estado: string; label: string }> = {
  recibido: { estado: 'en_preparacion', label: 'Preparar' },
  pagado: { estado: 'en_preparacion', label: 'Preparar' },
  en_preparacion: { estado: 'listo', label: 'Marcar listo' },
  listo: { estado: 'en_camino', label: 'Despachar' },
  en_camino: { estado: 'entregado', label: 'Entregado' },
};
const distTexto = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`);

export function EnviosWorkspace() {
  const [envios, setEnvios] = useState<any[]>([]);
  const [reps, setReps] = useState<any[]>([]);
  const [cargando, setCargando] = useState(true);

  const cargar = async () => {
    const [re, rr] = await Promise.all([fetch('/api/envios'), fetch('/api/repartidores')]);
    if (re.ok) setEnvios(await re.json());
    if (rr.ok) setReps(await rr.json());
    setCargando(false);
  };
  useEffect(() => {
    cargar();
    const t = setInterval(() => { fetch('/api/envios').then((r) => { if (r.ok) r.json().then(setEnvios); }); }, 8000);
    return () => clearInterval(t);
  }, []);

  const asignar = async (id: string, repartidorId: string) => {
    await fetch(`/api/pedidos/${id}/repartidor`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ repartidorId }) });
    cargar();
  };
  const avanzar = async (id: string, estado: string) => {
    await fetch('/api/pedidos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pedidoId: id, estado }) });
    cargar();
  };

  const enCurso = envios.filter((e) => e.estado === 'en_camino').length;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {[['Envíos activos', envios.length], ['En camino', enCurso], ['Repartidores', reps.length]].map(([l, v]: any, i) => (
          <div key={l} className={`rounded-xl p-4 ${i === 1 ? 'bg-[#B82D25] text-white' : 'bg-white'}`}>
            <p className={`text-xs ${i === 1 ? 'text-white/80' : 'text-black/50'}`}>{l}</p>
            <p className={`text-xl font-semibold ${i === 1 ? 'text-white' : 'text-black'}`}>{v}</p>
          </div>
        ))}
      </div>

      {cargando ? (
        <p className="rounded-xl bg-white px-4 py-8 text-center text-black/40 text-sm">Cargando…</p>
      ) : envios.length === 0 ? (
        <p className="rounded-xl bg-white px-4 py-8 text-center text-black/40 text-sm">No hay envíos a domicilio activos.</p>
      ) : envios.map((e) => {
        const sig = SIGUIENTE[e.estado];
        return (
          <div key={e.id} className="rounded-xl bg-white p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-black">{e.cliente?.nombre ?? 'Cliente'} <span className="text-black/40 font-normal">· {pesos(e.total)}</span></p>
                <p className="text-xs text-black/55 mt-0.5">{e.destino_direccion ?? 'Sin dirección'} · {e.qr_retiro}</p>
                {e.estado === 'en_camino' && e.etaMin != null && (
                  <p className="text-xs text-green-700 mt-0.5">🛵 {e.repartidor_nombre} · a {distTexto(e.distancia_m)} · ~{e.etaMin} min</p>
                )}
              </div>
              <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${ESTADO_BADGE[e.estado] ?? ''}`}>{ESTADO_LABEL[e.estado] ?? e.estado}</span>
            </div>
            <div className="flex flex-wrap items-center gap-2 mt-3">
              <select value={e.repartidor_id ?? ''} onChange={(ev) => asignar(e.id, ev.target.value)} className="rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-black outline-none">
                <option value="" disabled>Asignar repartidor…</option>
                {reps.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
              </select>
              {sig && <button onClick={() => avanzar(e.id, sig.estado)} className="rounded-full bg-[#B82D25] text-white text-sm font-medium px-4 py-2 hover:bg-[#932A1F]">{sig.label}</button>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
