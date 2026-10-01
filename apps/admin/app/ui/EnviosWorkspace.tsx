'use client';

import { useEffect, useState } from 'react';
import { Boton, Cargando, Etiqueta, Kpi, Monto, Selector, Tarjeta, Vacio, type TonoEtiqueta } from './kit';

const ESTADO_LABEL: Record<string, string> = { recibido: 'Recibido', pagado: 'Pagado', en_preparacion: 'En preparación', listo: 'Listo', en_camino: 'En camino', entregado: 'Entregado' };
// El mismo tono por estado que en la vista del repartidor (Listo = ok, En camino = info).
const ESTADO_TONO: Record<string, TonoEtiqueta> = { recibido: 'atencion', pagado: 'atencion', en_preparacion: 'neutro', listo: 'ok', en_camino: 'info', entregado: 'neutro' };
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
    try {
      const [re, rr] = await Promise.all([fetch('/api/envios'), fetch('/api/repartidores')]);
      if (re.ok) setEnvios(await re.json());
      if (rr.ok) setReps(await rr.json());
    } catch {
      /* red caída: no dejamos la pantalla colgada en "Cargando…" */
    } finally {
      setCargando(false);
    }
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
    <div className="space-y-4 sm:space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Kpi etiqueta="Envíos activos" valor={envios.length} />
        <Kpi etiqueta="En camino" valor={enCurso} tono="info" />
        <Kpi etiqueta="Repartidores" valor={reps.length} />
      </div>

      {cargando ? (
        <Tarjeta relleno={false}>
          <Cargando bloque />
        </Tarjeta>
      ) : envios.length === 0 ? (
        <Vacio titulo="No hay envíos a domicilio activos." />
      ) : (
        <div className="space-y-3">
          {envios.map((e) => {
            const sig = SIGUIENTE[e.estado];
            return (
              <Tarjeta key={e.id}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="break-words text-sm font-semibold text-tinta">
                      {e.cliente?.nombre ?? 'Cliente'} <span className="font-normal text-tinta/60">· <Monto valor={e.total ?? 0} /></span>
                    </p>
                    <p className="mt-0.5 break-words text-xs text-tinta/70">{e.destino_direccion ?? 'Sin dirección'} · {e.qr_retiro}</p>
                    {e.notas && <p className="mt-0.5 break-words text-xs text-atencion">Indicaciones: {e.notas}</p>}
                    {e.estado === 'en_camino' && e.etaMin != null && (
                      <p className="mt-0.5 text-xs text-info">🛵 {e.repartidor_nombre} · a {distTexto(e.distancia_m)} · ~{e.etaMin} min</p>
                    )}
                  </div>
                  <Etiqueta tono={ESTADO_TONO[e.estado] ?? 'neutro'} className="shrink-0">{ESTADO_LABEL[e.estado] ?? e.estado}</Etiqueta>
                </div>
                <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                  <Selector
                    value={e.repartidor_id ?? ''}
                    onChange={(ev) => asignar(e.id, ev.target.value)}
                    aria-label="Repartidor asignado"
                    className="sm:w-64"
                  >
                    <option value="" disabled>Asignar repartidor…</option>
                    {reps.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
                  </Selector>
                  {sig && <Boton onClick={() => avanzar(e.id, sig.estado)}>{sig.label}</Boton>}
                </div>
              </Tarjeta>
            );
          })}
        </div>
      )}
    </div>
  );
}
