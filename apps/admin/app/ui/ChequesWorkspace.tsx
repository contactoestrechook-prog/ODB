'use client';

import { useEffect, useState } from 'react';

const pesos = (n: number) => '$' + Math.round(n || 0).toLocaleString('es-AR');
const fecha = (s?: string) => (s ? new Date(s + 'T00:00:00').toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—');

const ESTADO_CHIP: Record<string, string> = {
  cartera: 'bg-sky-100 text-sky-900',
  depositado: 'bg-indigo-100 text-indigo-900',
  acreditado: 'bg-emerald-100 text-emerald-900',
  rechazado: 'bg-[#B82D25]/10 text-[#932A1F]',
  aplicado: 'bg-amber-100 text-amber-900',
  emitido: 'bg-violet-100 text-violet-900',
  debitado: 'bg-emerald-100 text-emerald-900',
  anulado: 'bg-black/10 text-black/50',
};
const ESTADO_LABEL: Record<string, string> = {
  cartera: 'En cartera', depositado: 'Depositado', acreditado: 'Acreditado', rechazado: 'Rechazado',
  aplicado: 'Endosado', emitido: 'Emitido', debitado: 'Debitado', anulado: 'Anulado',
};

type Cheque = any;

export function ChequesWorkspace({ resumen: resumenInicial, cheques: chequesInicial }: { resumen: any; cheques: Cheque[] }) {
  const [resumen, setResumen] = useState(resumenInicial);
  const [cheques, setCheques] = useState<Cheque[]>(chequesInicial ?? []);
  const [tipo, setTipo] = useState<'' | 'terceros' | 'propio'>('');
  const [estado, setEstado] = useState('');
  const [buscar, setBuscar] = useState('');
  const [cargando, setCargando] = useState(false);
  const [nuevo, setNuevo] = useState(false);
  const [accion, setAccion] = useState<{ id: string; tipo: 'rechazar' | 'aplicar' | 'depositar' | 'anular' } | null>(null);

  const recargar = async () => {
    setCargando(true);
    const qs = new URLSearchParams();
    if (tipo) qs.set('tipo', tipo);
    if (estado) qs.set('estado', estado);
    if (buscar.trim()) qs.set('buscar', buscar.trim());
    const [lst, res] = await Promise.all([
      fetch(`/api/cheques?${qs}`).then((r) => r.json()),
      fetch('/api/cheques?recurso=resumen').then((r) => r.json()),
    ]);
    setCheques(Array.isArray(lst) ? lst : []);
    setResumen(res);
    setCargando(false);
  };

  useEffect(() => {
    const t = setTimeout(recargar, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tipo, estado, buscar]);

  const accionRapida = async (id: string, accion: string, extra?: any) => {
    await fetch('/api/cheques', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accion, id, ...extra }),
    });
    recargar();
  };

  const KPIS = [
    { label: 'En cartera', valor: pesos(resumen?.carteraImporte), sub: `${resumen?.carteraCantidad ?? 0} cheques de terceros` },
    { label: 'Vencen en 7 días', valor: pesos(resumen?.venceEn7Importe), sub: `${resumen?.venceEn7Cantidad ?? 0} a depositar`, alerta: (resumen?.venceEn7Cantidad ?? 0) > 0 },
    { label: 'Depositados', valor: pesos(resumen?.depositadosImporte), sub: 'esperando acreditación' },
    { label: 'Rechazados', valor: pesos(resumen?.rechazadosImporte), sub: `${resumen?.rechazadosCantidad ?? 0} rebotados`, alerta: (resumen?.rechazadosCantidad ?? 0) > 0 },
    { label: 'Propios pendientes', valor: pesos(resumen?.propiosPendientesImporte), sub: 'a debitar del banco' },
  ];

  return (
    <div className="space-y-5">
      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {KPIS.map((k) => (
          <div key={k.label} className="rounded-xl bg-white p-4 border border-black/[0.04]">
            <p className={`text-xl font-semibold ${k.alerta ? 'text-[#B82D25]' : 'text-black'}`}>{k.valor}</p>
            <p className="text-[11px] text-black/45 mt-1">{k.label}</p>
            <p className="text-[10px] text-black/35 mt-0.5">{k.sub}</p>
          </div>
        ))}
      </div>

      {/* filtros */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg bg-white border border-black/10 overflow-hidden text-sm">
          {[['', 'Todos'], ['terceros', 'De terceros'], ['propio', 'Propios']].map(([v, l]) => (
            <button key={v} onClick={() => setTipo(v as any)}
              className={`px-3 py-1.5 ${tipo === v ? 'bg-[#B82D25] text-white' : 'text-black/55 hover:bg-black/5'}`}>{l}</button>
          ))}
        </div>
        <select value={estado} onChange={(e) => setEstado(e.target.value)} className="rounded-lg border border-black/10 bg-white px-3 py-1.5 text-sm">
          <option value="">Todos los estados</option>
          <option value="cartera">En cartera</option>
          <option value="depositado">Depositados</option>
          <option value="acreditado">Acreditados</option>
          <option value="aplicado">Endosados</option>
          <option value="rechazado">Rechazados</option>
          <option value="emitido">Propios emitidos</option>
          <option value="debitado">Propios debitados</option>
        </select>
        <input value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Buscar N°, banco, librador…"
          className="flex-1 min-w-[180px] rounded-lg border border-black/10 bg-white px-3 py-1.5 text-sm" />
        <button onClick={() => setNuevo(true)} className="rounded-lg bg-[#B82D25] text-white text-sm font-medium px-4 py-1.5 hover:bg-[#9e251e]">+ Cargar cheque</button>
      </div>

      {/* tabla */}
      <section className="rounded-xl bg-white overflow-hidden">
        {cargando && <p className="px-4 py-8 text-center text-black/40 text-sm">Cargando…</p>}
        {!cargando && cheques.length === 0 && <p className="px-4 py-10 text-center text-black/40 text-sm">No hay cheques con estos filtros.</p>}
        {!cargando && cheques.length > 0 && (
          <table className="w-full text-sm text-black">
            <thead>
              <tr className="border-b border-black/10 text-left text-xs text-black/50">
                <th className="px-4 py-3 font-medium">Cheque</th>
                <th className="px-4 py-3 font-medium">Origen / destino</th>
                <th className="px-4 py-3 font-medium">Cobro</th>
                <th className="px-4 py-3 font-medium text-right">Importe</th>
                <th className="px-4 py-3 font-medium text-center">Estado</th>
                <th className="px-4 py-3 font-medium text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {cheques.map((c) => {
                const vencido = c.estado === 'cartera' && c.fecha_cobro && c.fecha_cobro < new Date().toISOString().slice(0, 10);
                return (
                  <tr key={c.id} className={`border-b border-black/5 last:border-0 hover:bg-[#F0EBE2]/40 ${c.estado === 'anulado' ? 'opacity-50' : ''}`}>
                    <td className="px-4 py-2.5">
                      <p className="font-mono text-xs">N° {c.numero}</p>
                      <p className="text-[11px] text-black/45">{c.banco || 'banco s/d'}{c.titular ? ` · ${c.titular}` : ''} · {c.tipo === 'propio' ? 'propio' : 'terceros'}</p>
                    </td>
                    <td className="px-4 py-2.5 text-xs">
                      {c.cliente?.razon_social ?? c.cliente?.nombre ?? c.proveedor?.razon_social ?? '—'}
                    </td>
                    <td className={`px-4 py-2.5 text-xs ${vencido ? 'text-[#B82D25] font-medium' : 'text-black/55'}`}>
                      {fecha(c.fecha_cobro)}{vencido ? ' ⚠' : ''}
                    </td>
                    <td className="px-4 py-2.5 text-right font-medium whitespace-nowrap">{pesos(c.importe)}</td>
                    <td className="px-4 py-2.5 text-center">
                      <span className={`text-[11px] font-medium rounded-full px-2 py-0.5 ${ESTADO_CHIP[c.estado] ?? ''}`}>{ESTADO_LABEL[c.estado] ?? c.estado}</span>
                    </td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap">
                      <div className="flex justify-end gap-1.5">
                        {c.tipo === 'terceros' && c.estado === 'cartera' && (
                          <>
                            <button onClick={() => accionRapida(c.id, 'depositar')} className="text-xs rounded-md bg-indigo-50 text-indigo-800 px-2 py-1 hover:bg-indigo-100">Depositar</button>
                            <button onClick={() => setAccion({ id: c.id, tipo: 'aplicar' })} className="text-xs rounded-md bg-amber-50 text-amber-800 px-2 py-1 hover:bg-amber-100">Endosar</button>
                            <button onClick={() => setAccion({ id: c.id, tipo: 'rechazar' })} className="text-xs rounded-md bg-[#B82D25]/5 text-[#932A1F] px-2 py-1 hover:bg-[#B82D25]/10">Rechazar</button>
                          </>
                        )}
                        {c.tipo === 'terceros' && c.estado === 'depositado' && (
                          <>
                            <button onClick={() => accionRapida(c.id, 'acreditar')} className="text-xs rounded-md bg-emerald-50 text-emerald-800 px-2 py-1 hover:bg-emerald-100">Acreditar</button>
                            <button onClick={() => setAccion({ id: c.id, tipo: 'rechazar' })} className="text-xs rounded-md bg-[#B82D25]/5 text-[#932A1F] px-2 py-1 hover:bg-[#B82D25]/10">Rechazar</button>
                          </>
                        )}
                        {c.tipo === 'propio' && c.estado === 'emitido' && (
                          <>
                            <button onClick={() => accionRapida(c.id, 'debitar')} className="text-xs rounded-md bg-emerald-50 text-emerald-800 px-2 py-1 hover:bg-emerald-100">Debitado</button>
                            <button onClick={() => setAccion({ id: c.id, tipo: 'rechazar' })} className="text-xs rounded-md bg-[#B82D25]/5 text-[#932A1F] px-2 py-1 hover:bg-[#B82D25]/10">Rechazar</button>
                          </>
                        )}
                        {['cartera', 'depositado', 'emitido'].includes(c.estado) && (
                          <button onClick={() => setAccion({ id: c.id, tipo: 'anular' })} className="text-xs rounded-md text-black/40 px-2 py-1 hover:bg-black/5">Anular</button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      {nuevo && <NuevoCheque onClose={() => setNuevo(false)} onSaved={() => { setNuevo(false); recargar(); }} />}
      {accion && <AccionCheque accion={accion} onClose={() => setAccion(null)} onDone={() => { setAccion(null); recargar(); }} />}
    </div>
  );
}

// ----- modal cargar cheque -----
function NuevoCheque({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<any>({ tipo: 'terceros', numero: '', banco: '', titular: '', importe: '', fechaCobro: '' });
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);
  const set = (k: string, v: any) => setF((p: any) => ({ ...p, [k]: v }));

  const guardar = async () => {
    setError('');
    if (!f.numero.trim() || !(Number(f.importe) > 0)) return setError('Número e importe son obligatorios');
    setGuardando(true);
    const res = await fetch('/api/cheques', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accion: 'crear', ...f, importe: Number(f.importe) }),
    });
    const d = await res.json();
    setGuardando(false);
    if (!res.ok) return setError(d?.message || 'No se pudo guardar');
    onSaved();
  };

  return (
    <Overlay onClose={onClose} titulo="Cargar cheque">
      <div className="space-y-3">
        <div className="flex rounded-lg bg-black/5 p-0.5 text-sm">
          {[['terceros', 'De terceros (recibido)'], ['propio', 'Propio (emitido)']].map(([v, l]) => (
            <button key={v} onClick={() => set('tipo', v)} className={`flex-1 rounded-md py-1.5 ${f.tipo === v ? 'bg-white shadow-sm font-medium' : 'text-black/55'}`}>{l}</button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Campo label="N° cheque" v={f.numero} on={(v) => set('numero', v)} />
          <Campo label="Importe" v={f.importe} on={(v) => set('importe', v)} tipo="number" />
          <Campo label="Banco" v={f.banco} on={(v) => set('banco', v)} />
          <Campo label={f.tipo === 'propio' ? 'Titular' : 'Librador'} v={f.titular} on={(v) => set('titular', v)} />
          <Campo label="Fecha de cobro" v={f.fechaCobro} on={(v) => set('fechaCobro', v)} tipo="date" />
        </div>
        {error && <p className="text-sm text-[#B82D25]">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="text-sm text-black/50 px-3 py-2">Cancelar</button>
          <button onClick={guardar} disabled={guardando} className="rounded-lg bg-[#B82D25] text-white text-sm font-medium px-4 py-2 disabled:opacity-40">{guardando ? 'Guardando…' : 'Cargar'}</button>
        </div>
      </div>
    </Overlay>
  );
}

// ----- modal acción (rechazar / endosar / anular) -----
function AccionCheque({ accion, onClose, onDone }: { accion: { id: string; tipo: string }; onClose: () => void; onDone: () => void }) {
  const [motivo, setMotivo] = useState('');
  const [proveedorId, setProveedorId] = useState('');
  const [proveedores, setProveedores] = useState<any[]>([]);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (accion.tipo === 'aplicar') {
      fetch('/api/compras?recurso=proveedores').then((r) => r.json()).then((d) => setProveedores(Array.isArray(d) ? d : []));
    }
  }, [accion.tipo]);

  const ejecutar = async () => {
    setGuardando(true);
    const extra = accion.tipo === 'aplicar' ? { proveedorId } : accion.tipo === 'rechazar' || accion.tipo === 'anular' ? { motivo } : {};
    await fetch('/api/cheques', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accion: accion.tipo, id: accion.id, ...extra }),
    });
    setGuardando(false);
    onDone();
  };

  const TITULO: Record<string, string> = { rechazar: 'Rechazar cheque', aplicar: 'Endosar a proveedor', anular: 'Anular cheque' };
  return (
    <Overlay onClose={onClose} titulo={TITULO[accion.tipo] ?? 'Acción'}>
      <div className="space-y-3">
        {accion.tipo === 'aplicar' && (
          <select value={proveedorId} onChange={(e) => setProveedorId(e.target.value)} className="w-full rounded-lg border border-black/15 px-3 py-2 text-sm bg-white">
            <option value="">Elegí el proveedor…</option>
            {proveedores.map((p) => <option key={p.id} value={p.id}>{p.razon_social}</option>)}
          </select>
        )}
        {accion.tipo === 'rechazar' && (
          <>
            <p className="text-xs text-black/55">Si el cheque venía de una cobranza, se reabre la deuda del cliente en su cuenta corriente.</p>
            <Campo label="Motivo del rechazo" v={motivo} on={setMotivo} />
          </>
        )}
        {accion.tipo === 'anular' && <Campo label="Motivo (opcional)" v={motivo} on={setMotivo} />}
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="text-sm text-black/50 px-3 py-2">Cancelar</button>
          <button onClick={ejecutar} disabled={guardando || (accion.tipo === 'aplicar' && !proveedorId)} className="rounded-lg bg-[#B82D25] text-white text-sm font-medium px-4 py-2 disabled:opacity-40">
            {guardando ? '…' : 'Confirmar'}
          </button>
        </div>
      </div>
    </Overlay>
  );
}

function Overlay({ titulo, children, onClose }: { titulo: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-4 overflow-y-auto">
      <div className="bg-[#F7F4EE] rounded-2xl w-full max-w-md my-12 shadow-xl">
        <div className="px-5 py-4 border-b border-black/10 flex items-center justify-between">
          <h2 className="font-semibold text-black">{titulo}</h2>
          <button onClick={onClose} className="text-black/40 hover:text-black text-xl leading-none">×</button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

function Campo({ label, v, on, tipo = 'text' }: { label: string; v: string; on: (v: string) => void; tipo?: string }) {
  return (
    <label className="block">
      <span className="text-[11px] text-black/45">{label}</span>
      <input type={tipo} value={v} onChange={(e) => on(e.target.value)} className="mt-0.5 w-full rounded-md border border-black/15 px-2.5 py-1.5 text-sm bg-white" />
    </label>
  );
}
