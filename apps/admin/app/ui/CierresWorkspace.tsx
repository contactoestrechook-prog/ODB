'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const pesos = (n: any) => (n == null ? '—' : '$' + Math.round(Number(n)).toLocaleString('es-AR'));
const fechaHora = (iso: string) => (iso ? new Date(iso).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');

const TABS = [['cajas', 'Cajas'], ['porcajero', 'Por cajero'], ['diferencias', 'Diferencias'], ['historico', 'Histórico'], ['arca', 'Facturación ARCA']] as const;
const input = 'w-full rounded-lg border border-black/15 px-3 py-2.5 text-sm text-black focus:border-[#B82D25] focus:outline-none';

export function CierresWorkspace({ resumen, cajas, sesiones, arca, empleados = [] }: { resumen: any; cajas: any[]; sesiones: any[]; arca: any; empleados?: any[] }) {
  const router = useRouter();
  const [tab, setTab] = useState('cajas');
  const [modal, setModal] = useState<any>(null);
  const [aviso, setAviso] = useState('');
  const [resultado, setResultado] = useState<any>(null);
  const [porCajero, setPorCajero] = useState<any[] | null>(null);

  if (tab === 'porcajero' && porCajero === null) {
    fetch('/api/caja?recurso=por-cajero').then((r) => r.json()).then((d) => setPorCajero(Array.isArray(d) ? d : []));
  }

  const post = async (body: any) => {
    setAviso('');
    const res = await fetch('/api/caja', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const d = await res.json();
    if (!res.ok) { setAviso(d.message ?? 'Error'); return; }
    if (body.accion === 'cerrar') { setResultado(d); return; } // mostrar arqueo
    setModal(null); router.refresh();
  };

  const cerradas = sesiones.filter((s) => s.cerrada_en);
  const conDif = cerradas.filter((s) => s.diferencia != null && Number(s.diferencia) !== 0);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          ['Cajas abiertas', `${resumen?.cajasAbiertas ?? 0}/${resumen?.cajasTotal ?? 0}`],
          ['Base en cajas', pesos(resumen?.baseEnCajas)],
          ['Cierres del mes', resumen?.sesionesMes ?? 0],
          ['Con diferencia', resumen?.conDiferenciaMes ?? 0, resumen?.conDiferenciaMes > 0 ? 'text-[#B82D25]' : ''],
          ['Diferencia neta', pesos(resumen?.diferenciaNetaMes), Number(resumen?.diferenciaNetaMes) !== 0 ? 'text-[#B82D25]' : ''],
          ['ARCA pendientes', arca?.total ?? 0, arca?.total > 0 ? 'text-amber-600' : ''],
        ].map(([l, v, c]: any) => (
          <div key={l} className="rounded-xl bg-white p-3.5 border border-black/[0.04]"><p className={`text-lg font-semibold leading-none ${c || 'text-black'}`}>{v}</p><p className="text-[11px] text-black/45 mt-1">{l}</p></div>
        ))}
      </div>

      <div className="flex gap-1.5 flex-wrap border-b border-black/10">
        {TABS.map(([k, label]) => <button key={k} onClick={() => setTab(k)} className={`px-3.5 py-2 text-sm font-medium rounded-t-lg -mb-px border-b-2 ${tab === k ? 'border-[#B82D25] text-black' : 'border-transparent text-black/45 hover:text-black'}`}>{label}</button>)}
      </div>

      {aviso && <p className="rounded-lg bg-white p-3 text-sm text-[#B82D25]">{aviso}</p>}

      {/* CAJAS: abrir / arquear */}
      {tab === 'cajas' && (
        <div className="grid sm:grid-cols-2 gap-3">
          {cajas.map((c) => (
            <div key={c.id} className="rounded-xl bg-white p-5">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-medium text-black">{c.nombre}</p>
                  <p className="text-xs text-black/45">{c.sucursal?.nombre}</p>
                </div>
                <span className={`text-[11px] rounded-full px-2.5 py-0.5 ${c.sesionAbierta ? 'bg-emerald-100 text-emerald-800' : 'bg-[#F0EBE2] text-black/50'}`}>{c.sesionAbierta ? 'abierta' : 'cerrada'}</span>
              </div>
              {c.sesionAbierta ? (
                <div className="mt-3">
                  <p className="text-xs text-black/55">Base inicial {pesos(c.sesionAbierta.monto_inicial)} · abrió {c.sesionAbierta.usuario?.nombre ?? '—'}</p>
                  <p className="text-xs text-black/45">desde {fechaHora(c.sesionAbierta.abierta_en)}</p>
                  <button onClick={() => { setResultado(null); setModal({ tipo: 'cerrar', sesion: c.sesionAbierta, caja: c }); }} className="mt-3 rounded-full bg-[#B82D25] text-white text-xs font-medium px-4 py-2 hover:bg-[#932A1F]">Arquear y cerrar</button>
                </div>
              ) : (
                <button onClick={() => setModal({ tipo: 'abrir', caja: c })} className="mt-3 rounded-full bg-black text-white text-xs font-medium px-4 py-2 hover:bg-black/80">Abrir caja</button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* POR CAJERO (control de diferencias por persona) */}
      {tab === 'porcajero' && (
        porCajero === null ? <p className="rounded-xl bg-white p-8 text-center text-black/40 text-sm">Cargando…</p> :
        <Tabla titulo="Arqueos por cajero" vacio="Sin cierres registrados todavía."
          filas={porCajero} cols={['Cajero', 'Cierres', 'Total cerrado', 'Con dif.', 'Diferencia acum.']}
          render={(c: any, i: number) => (
            <tr key={i} className="border-b border-black/5 last:border-0">
              <td className="px-4 py-3"><p className="font-medium">{c.usuario}</p><p className="text-xs text-black/45">{c.rol}</p></td>
              <td className="px-4 py-3 text-right">{c.cierres}</td>
              <td className="px-4 py-3 text-right text-black/70">{pesos(c.totalCerrado)}</td>
              <td className="px-4 py-3 text-right">{c.conDiferencia}</td>
              <td className={`px-4 py-3 text-right font-semibold ${Number(c.diferenciaNeta) !== 0 ? 'text-[#B82D25]' : 'text-emerald-700'}`}>{Number(c.diferenciaNeta) !== 0 ? pesos(c.diferenciaNeta) : 'justo'}</td>
            </tr>
          )} />
      )}

      {/* DIFERENCIAS */}
      {tab === 'diferencias' && (
        <Tabla titulo={`Cierres con diferencia (${conDif.length})`} vacio="Sin diferencias de caja. Todos los arqueos cerraron justos."
          filas={conDif} cols={['Caja', 'Cajero', 'Cerrada', 'Esperado', 'Diferencia']}
          render={(s: any) => (
            <tr key={s.id} className="border-b border-black/5 last:border-0">
              <td className="px-4 py-3"><p className="font-medium">{s.caja?.nombre}</p><p className="text-xs text-black/45">{s.caja?.sucursal?.nombre}</p></td>
              <td className="px-4 py-3 text-black/70">{s.usuario?.nombre ?? '—'}</td>
              <td className="px-4 py-3 text-black/60 text-xs">{fechaHora(s.cerrada_en)}</td>
              <td className="px-4 py-3 text-right text-black/70">{pesos(Number(s.monto_cierre) - Number(s.diferencia))}</td>
              <td className={`px-4 py-3 text-right font-semibold ${Number(s.diferencia) < 0 ? 'text-[#B82D25]' : 'text-emerald-700'}`}>{Number(s.diferencia) > 0 ? '+' : ''}{pesos(s.diferencia)}</td>
            </tr>
          )} />
      )}

      {/* HISTÓRICO */}
      {tab === 'historico' && (
        <Tabla titulo={`Histórico de cierres (${cerradas.length})`} vacio="Todavía no hay cierres."
          filas={cerradas} cols={['Caja', 'Cajero', 'Abierta', 'Cerrada', 'Cierre', 'Dif.']}
          render={(s: any) => (
            <tr key={s.id} className="border-b border-black/5 last:border-0">
              <td className="px-4 py-2.5"><p className="font-medium">{s.caja?.nombre}</p><p className="text-xs text-black/45">{s.caja?.sucursal?.nombre}</p></td>
              <td className="px-4 py-2.5 text-black/70 text-xs">{s.usuario?.nombre ?? '—'}</td>
              <td className="px-4 py-2.5 text-black/55 text-xs">{fechaHora(s.abierta_en)}</td>
              <td className="px-4 py-2.5 text-black/55 text-xs">{fechaHora(s.cerrada_en)}</td>
              <td className="px-4 py-2.5 text-right">{pesos(s.monto_cierre)}</td>
              <td className={`px-4 py-2.5 text-right text-xs font-medium ${Number(s.diferencia) !== 0 ? 'text-[#B82D25]' : 'text-black/40'}`}>{Number(s.diferencia) !== 0 ? pesos(s.diferencia) : 'justo'}</td>
            </tr>
          )} />
      )}

      {/* ARCA */}
      {tab === 'arca' && (
        <section className="rounded-xl bg-white p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-medium text-black">Facturación electrónica ARCA</h2>
              <p className="text-xs text-black/50 mt-0.5">{arca?.total ?? 0} comprobantes esperando CAE.</p>
            </div>
            <button onClick={() => post({ accion: 'arca' })} disabled={!arca?.configurado} className="rounded-full bg-[#B82D25] text-white text-sm font-medium px-5 py-2.5 hover:bg-[#932A1F] disabled:opacity-50">Emitir pendientes</button>
          </div>
          {!arca?.configurado && (
            <p className="rounded-lg bg-[#F0EBE2]/70 p-3 text-xs text-black/70 leading-relaxed">
              ⚠️ ARCA todavía no está configurado. Para emitir CAE reales hay que cargar el certificado digital del CUIT de O.D.B (ARCA_CUIT, ARCA_CERT_PATH, ARCA_KEY_PATH). Mientras tanto los comprobantes quedan numerados y en cola.
            </p>
          )}
        </section>
      )}

      {/* MODALES */}
      {modal?.tipo === 'abrir' && (
        <Modal cerrar={() => setModal(null)}>
          <h2 className="font-semibold text-black text-lg">Abrir {modal.caja.nombre}</h2>
          <p className="text-xs text-black/45">{modal.caja.sucursal?.nombre}</p>
          <label className="text-xs text-black/50">Cajero que toma la caja</label>
          <select id="empleadoId" className={input + ' bg-white'} defaultValue="">
            <option value="">— elegir empleado —</option>
            {empleados.filter((e: any) => e.activo !== false).map((e: any) => <option key={e.id} value={e.id}>{e.nombre} ({e.rol})</option>)}
          </select>
          <label className="text-xs text-black/50">Base inicial (efectivo en caja al abrir)</label>
          <input id="montoInicial" type="number" placeholder="0" className={input} />
          <Acciones cerrar={() => setModal(null)} okLabel="Abrir caja" onOk={() => post({ accion: 'abrir', cajaId: modal.caja.id, montoInicial: Number((document.getElementById('montoInicial') as HTMLInputElement)?.value || 0), empleadoId: (document.getElementById('empleadoId') as HTMLSelectElement)?.value || undefined })} />
        </Modal>
      )}

      {modal?.tipo === 'cerrar' && (
        <Modal cerrar={() => { setModal(null); setResultado(null); }}>
          {resultado ? (
            <div className="space-y-2 text-center">
              <h2 className="font-semibold text-black text-lg">Arqueo de {modal.caja.nombre}</h2>
              <div className="rounded-xl bg-[#F0EBE2]/60 p-4 space-y-1 text-sm">
                <p className="flex justify-between"><span className="text-black/55">Esperado en caja</span><span>{pesos(resultado.esperado)}</span></p>
                <p className="flex justify-between"><span className="text-black/55">Contado</span><span>{pesos(resultado.contado)}</span></p>
                <p className={`flex justify-between font-semibold text-base border-t border-black/10 pt-1 ${Number(resultado.diferencia) !== 0 ? 'text-[#B82D25]' : 'text-emerald-700'}`}>
                  <span>Diferencia</span><span>{Number(resultado.diferencia) > 0 ? '+' : ''}{pesos(resultado.diferencia)}</span>
                </p>
              </div>
              <p className="text-xs text-black/50">{Number(resultado.diferencia) === 0 ? 'Cerró justo ✓' : Number(resultado.diferencia) < 0 ? 'Faltó efectivo' : 'Sobró efectivo'}</p>
              <button onClick={() => { setModal(null); setResultado(null); router.refresh(); }} className="rounded-full bg-black text-white text-sm font-medium px-6 py-2.5 hover:bg-black/80">Listo</button>
            </div>
          ) : (
            <>
              <h2 className="font-semibold text-black text-lg">Arquear {modal.caja.nombre}</h2>
              <p className="text-xs text-black/45">Base {pesos(modal.sesion.monto_inicial)} · contá el efectivo y registralo. El sistema calcula la diferencia contra lo esperado.</p>
              <label className="text-xs text-black/50">Efectivo contado en caja</label>
              <input id="montoCierre" type="number" placeholder="0" className={input} autoFocus />
              {aviso && <p className="text-xs text-[#B82D25]">{aviso}</p>}
              <Acciones cerrar={() => setModal(null)} okLabel="Cerrar y arquear" onOk={() => post({ accion: 'cerrar', sesionId: modal.sesion.id, montoCierre: Number((document.getElementById('montoCierre') as HTMLInputElement)?.value || 0) })} />
            </>
          )}
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
function Tabla({ titulo, vacio, filas, cols, render }: any) {
  return (
    <section className="rounded-xl bg-white overflow-hidden">
      <h2 className="px-4 py-3 border-b border-black/10 font-medium text-black text-sm">{titulo}</h2>
      {filas.length === 0 ? <p className="px-4 py-8 text-center text-black/40 text-sm">{vacio}</p> : (
        <table className="w-full text-sm text-black">
          <thead><tr className="text-left text-xs text-black/50 border-b border-black/5">{cols.map((c: string, i: number) => <th key={c} className={`px-4 py-2 font-medium ${i >= 3 ? 'text-right' : ''}`}>{c}</th>)}</tr></thead>
          <tbody>{filas.map(render)}</tbody>
        </table>
      )}
    </section>
  );
}
