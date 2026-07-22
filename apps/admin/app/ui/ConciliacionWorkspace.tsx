'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const pesos = (n: any) => (n == null ? '—' : '$' + Math.round(Number(n)).toLocaleString('es-AR'));
const fecha = (s: string) => (s ? new Date(s).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' }) : '—');
const hoy = () => new Date().toISOString().slice(0, 10);
const MEDIO: Record<string, string> = { mercadopago: 'Mercado Pago', tarjeta: 'Tarjeta' };
const input = 'w-full rounded-lg border border-black/15 px-3 py-2.5 text-sm text-black focus:border-[#B82D25] focus:outline-none';

const TABS = [['pendientes', 'Por acreditar'], ['acreditadas', 'Acreditadas']] as const;

export function ConciliacionWorkspace({ resumen, pendientes }: { resumen: any; pendientes: any[] }) {
  const router = useRouter();
  const [tab, setTab] = useState('pendientes');
  const [modal, setModal] = useState<any>(null);
  const [aviso, setAviso] = useState('');
  const [acreditadas, setAcreditadas] = useState<any[] | null>(null);

  if (tab === 'acreditadas' && acreditadas === null) {
    fetch('/api/conciliacion?recurso=listar&estado=acreditada&dias=120')
      .then((r) => r.json())
      .then((d) => setAcreditadas(Array.isArray(d) ? d : []))
      .catch(() => setAcreditadas([]));
  }

  const post = async (body: any) => {
    setAviso('');
    const res = await fetch('/api/conciliacion', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const d = await res.json();
    if (!res.ok) { setAviso(d.message ?? 'Error'); return null; }
    setModal(null);
    router.refresh();
    return d;
  };

  const conciliarMP = async () => {
    const d = await post({ accion: 'mp' });
    if (d) setAviso(`Mercado Pago: ${d.conciliadas} acreditación(es) conciliada(s) de ${d.revisados} revisadas.`);
  };

  return (
    <div className="space-y-5">
      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          ['Por acreditar', pesos(resumen?.porAcreditar), resumen?.porAcreditar > 0 ? 'text-[#B82D25]' : ''],
          ['Pendientes', resumen?.pendientes ?? 0],
          ['Atrasadas', resumen?.atrasadas ?? 0, resumen?.atrasadas > 0 ? 'text-amber-600' : ''],
          ['Acreditado (mes)', pesos(resumen?.acreditadoMes)],
        ].map(([l, v, c]: any) => (
          <div key={l} className="rounded-xl bg-white p-3.5 border border-black/[0.04]">
            <p className={`text-lg font-semibold leading-none ${c || 'text-black'}`}>{v}</p>
            <p className="text-[11px] text-black/45 mt-1">{l}</p>
          </div>
        ))}
      </div>

      {/* por medio */}
      {Array.isArray(resumen?.porMedio) && resumen.porMedio.length > 0 && (
        <div className="grid sm:grid-cols-2 gap-3">
          {resumen.porMedio.map((m: any) => (
            <div key={m.medio} className="rounded-xl bg-white p-4 border border-black/[0.04] flex items-center justify-between">
              <div>
                <p className="font-medium text-black">{MEDIO[m.medio] ?? m.medio}</p>
                <p className="text-xs text-black/45 mt-0.5">{m.pendientes} por acreditar</p>
              </div>
              <p className="text-base font-semibold text-black">{pesos(m.por_acreditar)}</p>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-1.5 flex-wrap border-b border-black/10">
        {TABS.map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} className={`px-3.5 py-2 text-sm font-medium rounded-t-lg -mb-px border-b-2 ${tab === k ? 'border-[#B82D25] text-black' : 'border-transparent text-black/45 hover:text-black'}`}>{label}</button>
        ))}
      </div>

      {aviso && <p className="rounded-lg bg-white p-3 text-sm text-black/70">{aviso}</p>}

      {/* PENDIENTES */}
      {tab === 'pendientes' && (
        <>
          <div className="flex flex-wrap gap-2">
            <button onClick={conciliarMP} className="rounded-full bg-black text-white text-sm font-medium px-4 py-2 hover:bg-black/80">Conciliar con Mercado Pago</button>
            <button onClick={() => setModal({ tipo: 'lote' })} className="rounded-full bg-white border border-black/15 text-black text-sm font-medium px-4 py-2 hover:border-[#B82D25]">Acreditar en lote</button>
          </div>
          <section className="rounded-xl bg-white overflow-hidden">
            <h2 className="px-4 py-3 border-b border-black/10 font-medium text-black text-sm">Pendientes de acreditación ({pendientes.length})</h2>
            {pendientes.length === 0 ? (
              <p className="px-4 py-8 text-center text-emerald-700 text-sm">✓ Todo conciliado. No hay acreditaciones pendientes.</p>
            ) : (
              <table className="w-full text-sm text-black">
                <thead><tr className="text-left text-xs text-black/50 border-b border-black/5">
                  <th className="px-4 py-2 font-medium">Medio</th><th className="px-4 py-2 font-medium">Venta</th>
                  <th className="px-4 py-2 font-medium text-right">Bruto</th>
                  <th className="px-4 py-2 font-medium text-right">Acredita</th><th className="px-4 py-2"></th>
                </tr></thead>
                <tbody>
                  {pendientes.map((a) => {
                    const atrasada = a.fecha_estimada && a.fecha_estimada < hoy();
                    return (
                      <tr key={a.id} className="border-b border-black/5 last:border-0">
                        <td className="px-4 py-3">
                          <span className={`text-[11px] rounded-full px-2.5 py-0.5 ${a.medio === 'mercadopago' ? 'bg-sky-100 text-sky-800' : 'bg-violet-100 text-violet-800'}`}>
                            {MEDIO[a.medio] ?? a.medio}
                            {a.medio === 'tarjeta' && a.venta?.sucursal?.procesador_tarjeta ? ` · ${a.venta.sucursal.procesador_tarjeta === 'clover' ? 'Clover' : 'Getnet'}` : ''}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-black/55 text-xs">{fecha(a.venta?.vendida_en ?? a.creado_en)}</td>
                        <td className="px-4 py-3 text-right font-medium">{pesos(a.bruto)}</td>
                        <td className={`px-4 py-3 text-right text-xs ${atrasada ? 'text-amber-600 font-medium' : 'text-black/55'}`}>{fecha(a.fecha_estimada)}{atrasada ? ' ⚠' : ''}</td>
                        <td className="px-4 py-3 text-right"><button onClick={() => setModal({ tipo: 'acreditar', a })} className="rounded-full bg-[#B82D25] text-white text-xs font-medium px-3 py-1.5 hover:bg-[#932A1F]">Acreditar</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>
          <p className="text-xs text-black/45 px-1">La comisión real de Mercado Pago y tarjetas se carga sola al conciliar el extracto o al vincular el medio por API. Acá solo seguimos el bruto por acreditar.</p>
        </>
      )}

      {/* ACREDITADAS */}
      {tab === 'acreditadas' && (
        acreditadas === null ? <p className="rounded-xl bg-white p-8 text-center text-black/40 text-sm">Cargando…</p> :
        <section className="rounded-xl bg-white overflow-hidden">
          <h2 className="px-4 py-3 border-b border-black/10 font-medium text-black text-sm">Acreditadas (últimos 120 días · {acreditadas.length})</h2>
          {acreditadas.length === 0 ? <p className="px-4 py-8 text-center text-black/40 text-sm">Sin acreditaciones todavía.</p> : (
            <table className="w-full text-sm text-black">
              <thead><tr className="text-left text-xs text-black/50 border-b border-black/5">
                <th className="px-4 py-2 font-medium">Medio</th><th className="px-4 py-2 font-medium">Acreditó</th>
                <th className="px-4 py-2 font-medium text-right">Bruto</th><th className="px-4 py-2 font-medium text-right">Comisión real</th>
                <th className="px-4 py-2 font-medium text-right">%</th><th className="px-4 py-2 font-medium text-right">Neto real</th>
              </tr></thead>
              <tbody>
                {acreditadas.map((a) => {
                  const pct = Number(a.bruto) > 0 ? (Number(a.comision_real ?? 0) / Number(a.bruto)) * 100 : 0;
                  return (
                    <tr key={a.id} className="border-b border-black/5 last:border-0">
                      <td className="px-4 py-2.5"><span className={`text-[11px] rounded-full px-2.5 py-0.5 ${a.medio === 'mercadopago' ? 'bg-sky-100 text-sky-800' : 'bg-violet-100 text-violet-800'}`}>{MEDIO[a.medio] ?? a.medio}</span></td>
                      <td className="px-4 py-2.5 text-black/55 text-xs">{fecha(a.fecha_real)}</td>
                      <td className="px-4 py-2.5 text-right text-black/70">{pesos(a.bruto)}</td>
                      <td className="px-4 py-2.5 text-right text-[#932A1F]">{pesos(a.comision_real)}</td>
                      <td className="px-4 py-2.5 text-right text-xs text-black/50">{pct.toFixed(1)}%</td>
                      <td className="px-4 py-2.5 text-right font-medium">{pesos(a.neto_real)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      )}

      {/* MODAL acreditar */}
      {modal?.tipo === 'acreditar' && (
        <Modal cerrar={() => setModal(null)}>
          <h2 className="font-semibold text-black text-lg">Acreditar {MEDIO[modal.a.medio] ?? modal.a.medio}</h2>
          <p className="text-xs text-black/45">Bruto {pesos(modal.a.bruto)} · neto estimado {pesos(modal.a.neto_estimado)}. Cargá lo que realmente acreditó.</p>
          <label className="text-xs text-black/50">Neto real acreditado</label>
          <input id="netoReal" type="number" defaultValue={Math.round(Number(modal.a.neto_estimado))} className={input} autoFocus />
          <label className="text-xs text-black/50">Fecha de acreditación</label>
          <input id="fechaReal" type="date" defaultValue={hoy()} className={input} />
          <Acciones cerrar={() => setModal(null)} okLabel="Marcar acreditada" onOk={() => post({ accion: 'acreditar', id: modal.a.id, netoReal: Number((document.getElementById('netoReal') as HTMLInputElement)?.value || 0), fechaReal: (document.getElementById('fechaReal') as HTMLInputElement)?.value })} />
        </Modal>
      )}

      {/* MODAL lote */}
      {modal?.tipo === 'lote' && (
        <Modal cerrar={() => setModal(null)}>
          <h2 className="font-semibold text-black text-lg">Acreditar en lote</h2>
          <p className="text-xs text-black/45">Marca como acreditadas (al neto estimado) todas las pendientes de un medio hasta una fecha. Útil cuando llega una liquidación que cubre muchas ventas.</p>
          <label className="text-xs text-black/50">Medio</label>
          <select id="loteMedio" className={input + ' bg-white'} defaultValue="tarjeta">
            <option value="tarjeta">Tarjeta</option>
            <option value="mercadopago">Mercado Pago</option>
          </select>
          <label className="text-xs text-black/50">Hasta la fecha</label>
          <input id="loteHasta" type="date" defaultValue={hoy()} className={input} />
          <Acciones cerrar={() => setModal(null)} okLabel="Acreditar lote" onOk={() => post({ accion: 'lote', medio: (document.getElementById('loteMedio') as HTMLSelectElement)?.value, hasta: (document.getElementById('loteHasta') as HTMLInputElement)?.value })} />
        </Modal>
      )}
    </div>
  );
}

function Modal({ children, cerrar }: any) {
  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-[2px] flex items-center justify-center p-4 z-50" onClick={cerrar}>
      <div className="bg-white rounded-2xl w-full max-w-sm p-6 space-y-3 shadow-2xl" onClick={(e) => e.stopPropagation()}>{children}</div>
    </div>
  );
}
function Acciones({ cerrar, onOk, okLabel }: any) {
  const [c, setC] = useState(false);
  return (
    <div className="flex justify-end gap-3 pt-1">
      <button onClick={cerrar} className="text-sm text-black/60 px-4 py-2 hover:text-black">Cancelar</button>
      <button onClick={async () => { setC(true); try { await onOk(); } finally { setC(false); } }} disabled={c} className="rounded-full bg-[#B82D25] text-white text-sm font-medium px-6 py-2.5 hover:bg-[#932A1F] disabled:opacity-50">{c ? '…' : okLabel}</button>
    </div>
  );
}
