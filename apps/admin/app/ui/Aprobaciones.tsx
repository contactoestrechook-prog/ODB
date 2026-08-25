'use client';

import { useCallback, useEffect, useState } from 'react';

// La cola de firmas. Antes estaba repartida en cinco pantallas y lo que nadie
// miraba se enteraba el proveedor antes que la dirección. Acá arriba va lo que
// más días lleva esperando, no lo más caro: lo que frena a alguien es lo
// urgente.
const pesos = (n: any) => '$' + Math.round(Number(n) || 0).toLocaleString('es-AR');
const cuando = (s: string) => new Date(s).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

const ETIQUETA: Record<string, string> = {
  orden_compra: 'Orden de compra',
  orden_pago: 'Orden de pago',
  cobranza: 'Cobro a cuenta',
  cambio_factura: 'Cambio en factura',
  propuesta_costo: 'Cambio de costos',
};
// El PDF que respalda la firma, cuando el tipo tiene uno
const PDF: Record<string, string> = { orden_compra: 'oc', orden_pago: 'op' };

export function Aprobaciones({ puedeFirmar }: { puedeFirmar: boolean }) {
  const [items, setItems] = useState<any[]>([]);
  const [cargando, setCargando] = useState(true);
  const [trabajando, setTrabajando] = useState<string | null>(null);
  const [aviso, setAviso] = useState('');
  const [error, setError] = useState('');

  const cargar = useCallback(async () => {
    try {
      const r = await fetch('/api/aprobaciones');
      const d = await r.json();
      if (!r.ok) { setError(d?.message ?? 'No pude consultar la API'); return; }
      setItems(d.items ?? []);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error de red');
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    cargar();
    // la cola cambia sola: alguien carga un cobro o una OC mientras esto está abierto
    const t = setInterval(cargar, 60_000);
    return () => clearInterval(t);
  }, [cargar]);

  const resolver = async (it: any, decision: 'aprobar' | 'rechazar') => {
    if (trabajando) return;
    let motivo: string | undefined;
    if (decision === 'rechazar') {
      const m = prompt(`Motivo del rechazo (le llega a ${it.pidio ?? 'quien lo pidió'}):`);
      if (m === null) return;
      motivo = m;
    } else if (it.monto != null && it.monto > 0) {
      // firmar plata sin releer el monto es cómo se firma lo que no se quiso firmar
      if (!confirm(`${ETIQUETA[it.tipo]}: ${it.titulo}\n\nMonto: ${pesos(it.monto)}\n\n¿Confirmás la aprobación?`)) return;
    }
    setTrabajando(it.id);
    setAviso('');
    try {
      const r = await fetch('/api/aprobaciones', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tipo: it.tipo, id: it.id, decision, motivo }),
      });
      const d = await r.json();
      if (!r.ok) { setError(d?.message ?? 'No se pudo resolver'); return; }
      setError('');
      setAviso(decision === 'aprobar' ? `${ETIQUETA[it.tipo]} aprobada.` : `${ETIQUETA[it.tipo]} rechazada.`);
      setItems((xs) => xs.filter((x) => !(x.id === it.id && x.tipo === it.tipo)));
    } finally {
      setTrabajando(null);
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4 lg:p-6">
      <div>
        <h1 className="text-xl font-semibold text-black">Aprobaciones</h1>
        <p className="text-xs text-black/50">
          Órdenes de compra, órdenes de pago, cobros a cuenta, cambios de factura y cambios de costos. Todo lo que no está firmado, acá.
        </p>
      </div>

      {error && <p className="rounded-xl bg-white p-4 text-sm text-[#B82D25]">{error}</p>}
      {aviso && <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{aviso}</p>}
      {cargando && <p className="text-sm text-black/40">Cargando…</p>}

      {!cargando && items.length === 0 && !error && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
          <p className="text-sm text-emerald-800">No queda nada esperando firma.</p>
        </div>
      )}

      {items.length > 0 && (
        <div className="space-y-2.5">
          {items.map((it) => (
            <section key={`${it.tipo}-${it.id}`} className="rounded-2xl bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-black/5 px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-black/55">
                      {ETIQUETA[it.tipo] ?? it.tipo}
                    </span>
                    {it.dias >= 2 && (
                      <span className="rounded-full bg-[#FDF3F2] px-2.5 py-0.5 text-[10px] font-medium text-[#B82D25]">
                        esperando hace {it.dias} días
                      </span>
                    )}
                  </div>
                  <p className="mt-1.5 text-sm font-medium text-black">{it.titulo}</p>
                  <p className="text-[11px] text-black/50">
                    {it.detalle}
                    {it.pidio && ` · pidió ${it.pidio}`}
                    {` · ${cuando(it.cuando)}`}
                  </p>
                  {PDF[it.tipo] && (
                    <a href={`/api/documento?tipo=${PDF[it.tipo]}&id=${it.id}`} target="_blank" rel="noreferrer"
                      className="text-[11px] text-[#B82D25] underline">
                      ver el documento antes de firmar
                    </a>
                  )}
                </div>

                <div className="flex shrink-0 flex-col items-end gap-2">
                  {it.monto != null && <p className="text-lg font-semibold tabular-nums text-black">{pesos(it.monto)}</p>}
                  {puedeFirmar ? (
                    <div className="flex gap-2">
                      <button onClick={() => resolver(it, 'aprobar')} disabled={trabajando === it.id}
                        className="rounded-full bg-emerald-600 px-4 py-1.5 text-xs font-medium text-white disabled:opacity-50">
                        {trabajando === it.id ? '…' : 'Aprobar'}
                      </button>
                      <button onClick={() => resolver(it, 'rechazar')} disabled={trabajando === it.id}
                        className="rounded-full border border-[#B82D25]/40 px-3 py-1.5 text-xs font-medium text-[#B82D25] disabled:opacity-50">
                        Rechazar
                      </button>
                    </div>
                  ) : (
                    <span className="text-[11px] text-black/40">espera la firma del dueño</span>
                  )}
                </div>
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
