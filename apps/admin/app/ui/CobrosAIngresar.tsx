'use client';

import { useCallback, useEffect, useState } from 'react';

// Bandeja del dueño: los pagos a cuenta que tomaron los cajeros y todavía no
// bajaron la deuda. Los mira contra la caja o el posnet y los aprueba — recién
// ahí se aplica el pago a la cuenta corriente del cliente.
const pesos = (n: number) => '$' + Math.round(Number(n) || 0).toLocaleString('es-AR');
const fecha = (s: string) => new Date(s).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

export function CobrosAIngresar({ esDueno }: { esDueno: boolean }) {
  const [items, setItems] = useState<any[]>([]);
  const [vista, setVista] = useState<'pendiente' | 'aprobada' | 'rechazada'>('pendiente');
  const [trabajando, setTrabajando] = useState<string | null>(null);
  const [aviso, setAviso] = useState('');

  const cargar = useCallback(async (estado: string) => {
    try {
      const r = await fetch(`/api/cobranzas?estado=${estado}`);
      if (r.ok) setItems(await r.json());
    } catch { /* se reintenta al cambiar de pestaña */ }
  }, []);

  useEffect(() => { cargar(vista); }, [vista, cargar]);

  const resolver = async (id: string, accion: 'aprobar' | 'rechazar') => {
    if (trabajando) return;
    const respuesta = accion === 'rechazar' ? (prompt('Motivo del rechazo (le llega a quien lo cargó):') ?? undefined) : undefined;
    if (accion === 'rechazar' && respuesta === undefined) return;
    setTrabajando(id);
    setAviso('');
    try {
      const r = await fetch('/api/cobranzas', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accion, id, respuesta }),
      });
      const d = await r.json();
      if (!r.ok) { setAviso(d?.message ?? 'No se pudo resolver'); return; }
      if (accion === 'aprobar' && d?.saldoNuevo != null) {
        setAviso(`Aplicado. El cliente queda con saldo ${pesos(d.saldoNuevo)}.`);
      }
      cargar(vista);
    } finally {
      setTrabajando(null);
    }
  };

  const nombreDe = (c: any) => c.cliente?.razon_social || c.cliente?.nombre || '—';

  return (
    <section className="rounded-2xl bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-sm font-semibold text-black">Cobros a ingresar</h2>
        <div className="flex gap-1.5">
          {(['pendiente', 'aprobada', 'rechazada'] as const).map((e) => (
            <button key={e} onClick={() => setVista(e)} className={`rounded-full px-3 py-1 text-xs font-medium ${vista === e ? 'bg-black text-white' : 'bg-black/5 text-black/60 hover:bg-black/10'}`}>
              {e === 'pendiente' ? 'Pendientes' : e === 'aprobada' ? 'Aplicados' : 'Rechazados'}
            </button>
          ))}
        </div>
      </div>
      <p className="mt-0.5 text-[11px] text-black/45">
        El pago no baja la deuda hasta que se aprueba acá. Chequealo contra la caja o el posnet antes.
      </p>

      {aviso && <p className="mt-2 rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-800">{aviso}</p>}

      {items.length === 0 ? (
        <p className="mt-3 text-sm text-black/40">Nada {vista === 'pendiente' ? 'pendiente' : `en ${vista}s`}.</p>
      ) : (
        <div className="mt-3 divide-y divide-black/5 rounded-xl border border-black/10">
          {items.map((c) => (
            <div key={c.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
              <div className="min-w-0">
                <p className="text-sm text-black truncate">
                  <b>{nombreDe(c)}</b> · {pesos(c.monto)} <span className="text-black/50">({c.medio})</span>
                  {c.comprobanteUrl && (
                    <a href={c.comprobanteUrl} target="_blank" rel="noreferrer" className="ml-2 text-xs text-[#B82D25] underline">ver comprobante</a>
                  )}
                </p>
                <p className="text-[11px] text-black/45">
                  {fecha(c.cargada_en)} · cargó {c.cargador?.nombre ?? '—'}
                  {c.cliente?.saldo_cta_cte != null && vista === 'pendiente' && ` · saldo actual ${pesos(c.cliente.saldo_cta_cte)}`}
                  {c.nota && ` · "${c.nota}"`}
                  {vista !== 'pendiente' && c.aprobador?.nombre && ` · resolvió ${c.aprobador.nombre}`}
                  {c.respuesta && ` · ${c.respuesta}`}
                </p>
              </div>
              {vista === 'pendiente' && esDueno && (
                <div className="flex shrink-0 gap-2">
                  <button onClick={() => resolver(c.id, 'aprobar')} disabled={trabajando === c.id} className="rounded-full bg-emerald-600 px-4 py-1.5 text-xs font-medium text-white disabled:opacity-50">
                    {trabajando === c.id ? '…' : 'Aprobar'}
                  </button>
                  <button onClick={() => resolver(c.id, 'rechazar')} disabled={trabajando === c.id} className="rounded-full border border-[#B82D25]/40 px-3 py-1.5 text-xs font-medium text-[#B82D25]">
                    Rechazar
                  </button>
                </div>
              )}
              {vista === 'pendiente' && !esDueno && (
                <span className="shrink-0 text-[11px] text-black/40">espera aprobación</span>
              )}
              {/* Aplicado el pago, el cliente tiene derecho a su papel: recibo
                  con folio propio, que se puede volver a imprimir sin renumerar. */}
              {vista === 'aprobada' && (
                <a href={`/api/documento?tipo=recibo&id=${c.id}`} target="_blank" rel="noreferrer"
                  className="shrink-0 rounded-full border border-black/15 px-3 py-1.5 text-xs font-medium text-black/70 hover:bg-black/5">
                  Recibo
                </a>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
