'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

const pesos = (n: any) => '$' + Math.round(Number(n) || 0).toLocaleString('es-AR');
const fecha = (iso: string) => (iso ? new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—');

const ESTADO_ESTILO: Record<string, string> = {
  borrador: 'bg-[#F0EBE2] text-black/60', pendiente_aprobacion: 'bg-[#B82D25] text-white',
  aprobada: 'bg-black text-white', enviada: 'bg-black text-white',
  recibida_parcial: 'bg-amber-100 text-amber-900', recibida: 'bg-emerald-100 text-emerald-800',
  cancelada: 'bg-[#F0EBE2] text-black/40',
};
const ESTADO_LABEL: Record<string, string> = { pendiente_aprobacion: 'a aprobar', recibida_parcial: 'parcial' };
const OP_ESTILO: Record<string, string> = {
  pendiente_aprobacion: 'bg-[#B82D25] text-white', aprobada: 'bg-black text-white',
  pagada: 'bg-emerald-100 text-emerald-800', rechazada: 'bg-[#F0EBE2] text-black/40',
};
const OP_LABEL: Record<string, string> = { pendiente_aprobacion: 'a aprobar', aprobada: 'aprobada · a pagar', pagada: 'pagada', rechazada: 'rechazada' };

const TABS = [['ordenes', 'Órdenes'], ['aprobar', 'Por aprobar'], ['recepcion', 'Recepción'], ['proveedores', 'Proveedores'], ['pagos', 'Órdenes de pago'], ['sugerencias', 'Sugerencias']] as const;

const input = 'w-full rounded-lg border border-black/15 px-3 py-2.5 text-sm text-black focus:border-[#B82D25] focus:outline-none';

export function ComprasWorkspace({ resumen, ordenes, proveedores, sugerencias, sucursales }: {
  resumen: any; ordenes: any[]; proveedores: any[]; sugerencias: any[]; sucursales: any[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState('ordenes');
  const [modal, setModal] = useState<any>(null); // {tipo, ...}
  const [deuda, setDeuda] = useState<any[] | null>(null);
  const [pagos, setPagos] = useState<any[] | null>(null);
  const [aviso, setAviso] = useState('');

  useEffect(() => {
    if (tab === 'pagos' && deuda === null) {
      fetch('/api/compras?recurso=deuda').then((r) => r.json()).then((d) => setDeuda(Array.isArray(d) ? d : []));
      fetch('/api/compras?recurso=ordenes-pago').then((r) => r.json()).then((d) => setPagos(Array.isArray(d) ? d : []));
    }
  }, [tab]);

  const post = async (body: any) => {
    setAviso('');
    const res = await fetch('/api/compras', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const d = await res.json();
    if (!res.ok) { setAviso(d.message ?? 'Error'); return null; }
    setModal(null);
    router.refresh();
    if (tab === 'pagos') {
      const [dd, pp] = await Promise.all([
        fetch('/api/compras?recurso=deuda').then((r) => r.json()),
        fetch('/api/compras?recurso=ordenes-pago').then((r) => r.json()),
      ]);
      setDeuda(Array.isArray(dd) ? dd : []);
      setPagos(Array.isArray(pp) ? pp : []);
    }
    return d;
  };

  const porAprobar = ordenes.filter((o) => o.estado === 'pendiente_aprobacion');
  const porRecibir = ordenes.filter((o) => ['aprobada', 'enviada', 'recibida_parcial'].includes(o.estado));

  return (
    <div className="space-y-5">
      {/* KPIs + nueva OC */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex gap-7 flex-wrap">
          {[['Comprado (mes)', pesos(resumen?.compradoMes)], ['A aprobar', resumen?.pendientesAprobacion ?? 0, 'text-[#B82D25]'], ['Por recibir', resumen?.porRecibir ?? 0], ['Deuda proveedores', pesos(resumen?.deudaProveedores), resumen?.deudaProveedores > 0 ? 'text-[#B82D25]' : ''], ['Sugerencias', resumen?.sugerencias ?? 0]].map(([l, v, c]: any) => (
            <div key={l}><p className={`text-xl font-semibold leading-none ${c || 'text-black'}`}>{v}</p><p className="text-[11px] text-black/45 mt-1">{l}</p></div>
          ))}
        </div>
        <button onClick={() => setModal({ tipo: 'nuevaOC', items: [] })} className="rounded-full bg-[#B82D25] text-white text-sm font-medium px-5 py-2.5 hover:bg-[#932A1F] shadow-sm">+ Nueva orden de compra</button>
      </div>

      <div className="flex gap-1.5 flex-wrap border-b border-black/10">
        {TABS.map(([k, label]) => {
          const badge = k === 'aprobar' ? porAprobar.length : k === 'recepcion' ? porRecibir.length : k === 'sugerencias' ? sugerencias.length : 0;
          return <button key={k} onClick={() => setTab(k)} className={`px-3.5 py-2 text-sm font-medium rounded-t-lg -mb-px border-b-2 ${tab === k ? 'border-[#B82D25] text-black' : 'border-transparent text-black/45 hover:text-black'}`}>{label}{badge ? <span className="ml-1.5 text-[10px] rounded-full bg-[#B82D25] text-white px-1.5 py-0.5">{badge > 99 ? '99+' : badge}</span> : ''}</button>;
        })}
      </div>

      {aviso && <p className="rounded-lg bg-white p-3 text-sm text-[#B82D25]">{aviso}</p>}

      {/* ÓRDENES (todas) */}
      {(tab === 'ordenes' || tab === 'aprobar' || tab === 'recepcion') && (
        <div className="space-y-2">
          {(tab === 'ordenes' ? ordenes : tab === 'aprobar' ? porAprobar : porRecibir).map((o) => (
            <div key={o.numero} className="rounded-xl bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium text-black">OC #{o.numero} · {o.proveedor?.razon_social ?? '—'}
                    <span className={`ml-2 text-[11px] rounded-full px-2 py-0.5 ${ESTADO_ESTILO[o.estado] ?? ''}`}>{ESTADO_LABEL[o.estado] ?? o.estado}</span>
                  </p>
                  <p className="text-xs text-black/50 mt-0.5">
                    {o.sucursal?.nombre} · {fecha(o.creado_en)} · {(o.items ?? []).length} ítems
                    {o.condicion_pago && ` · ${o.condicion_pago}`}
                    {o.vencimiento_pago && ` · vence ${fecha(o.vencimiento_pago)}`}
                    {o.fecha_entrega && ` · entrega ${fecha(o.fecha_entrega)}`}
                    {o.firmadaPor && ` · aprobó ${o.firmadaPor}`}
                  </p>
                  {o.observaciones && <p className="text-xs text-black/40 mt-0.5 italic">“{o.observaciones}”</p>}
                  {o.estado === 'cancelada' && o.rechazo_motivo && <p className="text-xs text-[#B82D25] mt-0.5">Rechazada: {o.rechazo_motivo}</p>}
                </div>
                <div className="text-right whitespace-nowrap">
                  <p className="font-semibold text-black">{pesos(o.total)}</p>
                  <div className="flex gap-2 justify-end mt-1">
                    {o.estado === 'pendiente_aprobacion' && <>
                      <button onClick={() => post({ accion: 'aprobar', id: o.id })} className="text-xs font-medium text-emerald-700 hover:underline">Aprobar</button>
                      <button onClick={() => setModal({ tipo: 'rechazar', oc: o })} className="text-xs font-medium text-[#B82D25] hover:underline">Rechazar</button>
                    </>}
                    {['aprobada', 'enviada', 'recibida_parcial'].includes(o.estado) && <button onClick={() => setModal({ tipo: 'recibir', oc: o, recibido: {} })} className="text-xs font-medium text-emerald-700 hover:underline">Recibir</button>}
                  </div>
                </div>
              </div>
            </div>
          ))}
          {(tab === 'ordenes' ? ordenes : tab === 'aprobar' ? porAprobar : porRecibir).length === 0 && (
            <p className="rounded-xl bg-white p-8 text-center text-black/40 text-sm">
              {tab === 'aprobar' ? 'No hay órdenes esperando aprobación.' : tab === 'recepcion' ? 'No hay órdenes pendientes de recepción.' : 'Sin órdenes de compra. Creá una o miralas en Sugerencias.'}
            </p>
          )}
        </div>
      )}

      {/* PROVEEDORES */}
      {tab === 'proveedores' && (
        <div className="space-y-3">
          <div className="flex justify-end"><button onClick={() => setModal({ tipo: 'proveedor', prov: {} })} className="rounded-full bg-[#B82D25] text-white text-sm font-medium px-4 py-2 hover:bg-[#932A1F]">+ Nuevo proveedor</button></div>
          <section className="rounded-xl bg-white overflow-hidden">
            <table className="w-full text-sm text-black">
              <thead><tr className="text-left text-xs text-black/50 border-b border-black/5">
                <th className="px-4 py-2 font-medium">Proveedor</th><th className="px-4 py-2 font-medium">CUIT</th><th className="px-4 py-2 font-medium">Condición</th><th className="px-4 py-2 font-medium text-right">Entrega</th><th className="px-4 py-2" />
              </tr></thead>
              <tbody>
                {proveedores.map((p) => (
                  <tr key={p.id} className="border-b border-black/5 last:border-0">
                    <td className="px-4 py-3"><p className="font-medium">{p.razon_social}</p><p className="text-xs text-black/45">{p.email ?? ''}</p></td>
                    <td className="px-4 py-3 text-black/70">{p.cuit ?? '—'}</td>
                    <td className="px-4 py-3 text-black/70">{p.condicion_pago ?? '—'}</td>
                    <td className="px-4 py-3 text-right text-black/70">{p.lead_time_dias} días</td>
                    <td className="px-4 py-3 text-right"><button onClick={() => setModal({ tipo: 'proveedor', prov: p })} className="text-xs text-[#B82D25] hover:underline">Editar</button></td>
                  </tr>
                ))}
                {proveedores.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-black/40 text-sm">Sin proveedores. Agregá el primero.</td></tr>}
              </tbody>
            </table>
          </section>
        </div>
      )}

      {/* ÓRDENES DE PAGO */}
      {tab === 'pagos' && (
        <div className="space-y-3">
          <div className="flex justify-end"><button onClick={() => setModal({ tipo: 'factura' })} className="rounded-full bg-white border border-black/15 text-black text-sm font-medium px-4 py-2 hover:border-black/40">+ Registrar factura de proveedor</button></div>
          <section className="rounded-xl bg-white overflow-hidden">
            <h2 className="px-4 py-3 border-b border-black/10 font-medium text-black text-sm">Cuentas a pagar (por proveedor)</h2>
            {deuda === null ? <p className="px-4 py-6 text-center text-black/40 text-sm">Cargando…</p>
              : deuda.length === 0 ? <p className="px-4 py-6 text-center text-black/40 text-sm">Sin facturas pendientes de pago.</p>
              : deuda.map((d) => (
                <div key={d.proveedor?.id} className="px-4 py-3 border-b border-black/5 last:border-0 flex items-center justify-between gap-3">
                  <div><p className="font-medium text-black">{d.proveedor?.razon_social}</p><p className="text-xs text-black/50">{d.facturas.length} factura(s) · próx. vence {fecha(d.facturas[0]?.vencimiento)}</p></div>
                  <div className="text-right"><p className="font-semibold text-[#B82D25]">{pesos(d.total)}</p>
                    <button onClick={() => setModal({ tipo: 'pagar', prov: d })} className="text-xs font-medium text-emerald-700 hover:underline">Crear orden de pago →</button></div>
                </div>
              ))}
          </section>
          {pagos && pagos.length > 0 && (
            <section className="rounded-xl bg-white overflow-hidden">
              <h2 className="px-4 py-3 border-b border-black/10 font-medium text-black text-sm">Órdenes de pago</h2>
              {pagos.map((p) => (
                <div key={p.numero} className="px-4 py-2.5 border-b border-black/5 last:border-0 flex items-center justify-between gap-3 text-sm">
                  <div>
                    <span className="text-black">OP #{p.numero} · {p.proveedor?.razon_social}</span>
                    <span className={`ml-2 text-[10px] rounded-full px-2 py-0.5 ${OP_ESTILO[p.estado] ?? 'bg-[#F0EBE2] text-black/60'}`}>{OP_LABEL[p.estado] ?? p.estado}</span>
                    <p className="text-xs text-black/45">{p.medio_pago}{p.vencimiento ? ` · vence ${fecha(p.vencimiento)}` : ''}{p.pagada_en ? ` · pagada ${fecha(p.pagada_en)}` : ''}</p>
                  </div>
                  <div className="text-right whitespace-nowrap">
                    <p className="font-medium">{pesos(p.total)}</p>
                    <div className="flex gap-2 justify-end mt-0.5">
                      {p.estado === 'pendiente_aprobacion' && <>
                        <button onClick={() => post({ accion: 'aprobarOP', id: p.id })} className="text-xs font-medium text-emerald-700 hover:underline">Aprobar</button>
                        <button onClick={() => setModal({ tipo: 'rechazarOP', op: p })} className="text-xs font-medium text-[#B82D25] hover:underline">Rechazar</button>
                      </>}
                      {p.estado === 'aprobada' && <button onClick={() => post({ accion: 'pagarOP', id: p.id })} className="text-xs font-medium text-black hover:underline">Marcar pagada</button>}
                    </div>
                  </div>
                </div>
              ))}
            </section>
          )}
        </div>
      )}

      {/* SUGERENCIAS */}
      {tab === 'sugerencias' && (
        <section className="rounded-xl bg-white overflow-hidden">
          <div className="px-4 py-3 border-b border-black/10 flex items-center justify-between">
            <h2 className="font-medium text-black text-sm">Sugerencias de reposición</h2>
            <a href="/analista" className="text-xs text-[#B82D25] hover:underline">Pedir plan al Analista ODB →</a>
          </div>
          {sugerencias.length === 0 ? <p className="px-4 py-6 text-sm text-black/50">Nada para reponer por ahora.</p> : (
            <table className="w-full text-sm text-black">
              <thead><tr className="text-left text-xs text-black/50 border-b border-black/5"><th className="px-4 py-2 font-medium">Producto</th><th className="px-4 py-2 font-medium">Sucursal</th><th className="px-4 py-2 font-medium text-right">Stock</th><th className="px-4 py-2 font-medium text-right">Sugerido</th><th className="px-4 py-2 font-medium">Proveedor</th></tr></thead>
              <tbody>
                {sugerencias.slice(0, 100).map((s) => (
                  <tr key={`${s.sku}-${s.sucursal}`} className="border-b border-black/5 last:border-0">
                    <td className="px-4 py-2.5"><p className="font-medium">{s.producto}</p><p className="text-xs text-black/45">{s.sku}</p></td>
                    <td className="px-4 py-2.5 text-black/70">{s.sucursal}</td>
                    <td className="px-4 py-2.5 text-right">{Math.round(Number(s.cantidad))}</td>
                    <td className="px-4 py-2.5 text-right font-medium">{Math.round(Number(s.cantidad_sugerida))} u.</td>
                    <td className="px-4 py-2.5 text-black/70 text-xs">{s.proveedor ?? 'sin asignar'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {modal && <Modal modal={modal} setModal={setModal} post={post} proveedores={proveedores} sucursales={sucursales} aviso={aviso} />}
    </div>
  );
}

function Modal({ modal, setModal, post, proveedores, sucursales, aviso }: any) {
  const [f, setF] = useState<any>(modal.prov ?? modal);
  const set = (k: string, v: any) => setF((x: any) => ({ ...x, [k]: v }));
  const [items, setItems] = useState<any[]>([]);
  const [busca, setBusca] = useState(''); const [sug, setSug] = useState<any[]>([]);
  const [recibido, setRecibido] = useState<Record<string, string>>({});
  const [facturasSel, setFacturasSel] = useState<string[]>(modal.prov?.facturas?.map((x: any) => x.id) ?? []);

  useEffect(() => {
    if (busca.trim().length < 2) return setSug([]);
    const t = setTimeout(async () => { const r = await fetch(`/api/buscar-producto?q=${encodeURIComponent(busca)}`); if (r.ok) setSug((await r.json()).items ?? []); }, 250);
    return () => clearTimeout(t);
  }, [busca]);

  const cerrar = () => setModal(null);
  const t = modal.tipo;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-[2px] flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl w-full max-w-lg p-6 space-y-3 shadow-2xl max-h-[92vh] overflow-y-auto">
        {t === 'nuevaOC' && (<>
          <h2 className="font-semibold text-black text-lg">Nueva orden de compra</h2>
          <select className={input + ' bg-white'} value={f.proveedorId ?? ''} onChange={(e) => set('proveedorId', e.target.value)}>
            <option value="">Proveedor…</option>{proveedores.map((p: any) => <option key={p.id} value={p.id}>{p.razon_social}</option>)}
          </select>
          <select className={input + ' bg-white'} value={f.sucursalId ?? ''} onChange={(e) => set('sucursalId', e.target.value)}>
            <option value="">Sucursal destino…</option>{sucursales.map((s: any) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-[11px] text-black/45 block mb-1">Entrega esperada</label><input type="date" value={f.fechaEntrega ?? ''} onChange={(e) => set('fechaEntrega', e.target.value)} className={input} /></div>
            <div><label className="text-[11px] text-black/45 block mb-1">Vence el pago</label><input type="date" value={f.vencimientoPago ?? ''} onChange={(e) => set('vencimientoPago', e.target.value)} className={input} /></div>
          </div>
          <input value={f.condicionPago ?? ''} onChange={(e) => set('condicionPago', e.target.value)} placeholder="Condición de pago (contado / 30 días / cta cte…)" className={input} />
          <div className="relative">
            <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Agregar producto…" className={input} />
            {sug.length > 0 && <div className="absolute z-10 mt-1 w-full rounded-lg bg-white shadow-lg border border-black/10 max-h-48 overflow-y-auto">
              {sug.map((p: any) => <button key={p.sku} onClick={() => { setItems((xs) => [...xs, { sku: p.sku, nombre: p.nombre, cantidad: 1, costoUnitario: p.costo ?? 0 }]); setBusca(''); setSug([]); }} className="w-full text-left px-3 py-2 text-sm hover:bg-[#F0EBE2] border-b border-black/5 last:border-0">{p.nombre} <span className="text-xs text-black/40">{p.sku}</span></button>)}
            </div>}
          </div>
          {items.map((i, idx) => (
            <div key={idx} className="flex items-center gap-2 text-sm">
              <span className="flex-1 truncate">{i.nombre}</span>
              <input type="number" value={i.cantidad} onChange={(e) => setItems((xs) => xs.map((x, j) => j === idx ? { ...x, cantidad: Number(e.target.value) } : x))} className="w-16 rounded border border-black/15 px-2 py-1 text-right" />
              <input type="number" value={i.costoUnitario} onChange={(e) => setItems((xs) => xs.map((x, j) => j === idx ? { ...x, costoUnitario: Number(e.target.value) } : x))} className="w-24 rounded border border-black/15 px-2 py-1 text-right" placeholder="costo" />
              <button onClick={() => setItems((xs) => xs.filter((_, j) => j !== idx))} className="text-black/40 hover:text-[#B82D25]">✕</button>
            </div>
          ))}
          {aviso && <p className="text-xs text-[#B82D25]">{aviso}</p>}
          <textarea value={f.observaciones ?? ''} onChange={(e) => set('observaciones', e.target.value)} placeholder="Observaciones (opcional)" rows={2} className={input} />
          {items.length > 0 && <p className="text-right text-sm font-semibold text-black">Total OC: {pesos(items.reduce((s: number, i: any) => s + Number(i.cantidad) * Number(i.costoUnitario || 0), 0))}</p>}
          <p className="text-[11px] text-black/40">La OC queda <b>pendiente de aprobación del dueño</b>.</p>
          <Acciones cerrar={cerrar} onOk={() => post({ accion: 'crearOC', proveedorId: f.proveedorId, sucursalId: f.sucursalId, items, fechaEntrega: f.fechaEntrega, condicionPago: f.condicionPago, vencimientoPago: f.vencimientoPago, observaciones: f.observaciones })} okLabel="Crear OC" disabled={!f.proveedorId || !f.sucursalId || !items.length} />
        </>)}

        {t === 'rechazar' && (<>
          <h2 className="font-semibold text-black text-lg">Rechazar OC #{modal.oc.numero}</h2>
          <p className="text-sm text-black/60">{modal.oc.proveedor?.razon_social} · {pesos(modal.oc.total)}. Se cancela la orden y queda registrado el motivo.</p>
          <input value={f.motivo ?? ''} onChange={(e) => set('motivo', e.target.value)} placeholder="Motivo del rechazo (opcional)" className={input} autoFocus />
          {aviso && <p className="text-xs text-[#B82D25]">{aviso}</p>}
          <Acciones cerrar={cerrar} onOk={() => post({ accion: 'rechazar', id: modal.oc.id, motivo: f.motivo })} okLabel="Rechazar orden" />
        </>)}

        {t === 'rechazarOP' && (<>
          <h2 className="font-semibold text-black text-lg">Rechazar OP #{modal.op.numero}</h2>
          <p className="text-sm text-black/60">{modal.op.proveedor?.razon_social} · {pesos(modal.op.total)}. Las facturas vuelven a quedar pendientes.</p>
          <input value={f.motivo ?? ''} onChange={(e) => set('motivo', e.target.value)} placeholder="Motivo del rechazo (opcional)" className={input} autoFocus />
          {aviso && <p className="text-xs text-[#B82D25]">{aviso}</p>}
          <Acciones cerrar={cerrar} onOk={() => post({ accion: 'rechazarOP', id: modal.op.id, motivo: f.motivo })} okLabel="Rechazar OP" />
        </>)}

        {t === 'recibir' && (<>
          <h2 className="font-semibold text-black text-lg">Recibir OC #{modal.oc.numero}</h2>
          <p className="text-xs text-black/50">Ingresá lo que llegó de cada ítem. Al recibir se fija el costo de la compra y se calcula el precio de venta con el % de remarcación.</p>
          {(modal.oc.items ?? []).map((it: any, idx: number) => {
            const pend = Number(it.cantidad) - Number(it.cantidad_recibida ?? 0);
            return (
              <div key={idx} className="flex items-center gap-2 text-sm">
                <span className="flex-1 truncate">{it.producto?.nombre} <span className="text-xs text-black/40">(pend. {pend})</span></span>
                <input type="number" value={recibido[it.producto?.sku] ?? ''} onChange={(e) => setRecibido((r) => ({ ...r, [it.producto?.sku]: e.target.value }))} placeholder={String(pend)} className="w-20 rounded border border-black/15 px-2 py-1 text-right" />
              </div>
            );
          })}
          <div className="flex items-center gap-2 text-sm pt-2 mt-1 border-t border-black/10">
            <span className="flex-1 text-black/60">% de remarcación <span className="text-xs text-black/40">(vacío = usa el del rubro)</span></span>
            <input type="number" value={f.margenPct ?? ''} onChange={(e) => set('margenPct', e.target.value)} placeholder="rubro" className="w-20 rounded border border-black/15 px-2 py-1 text-right" />
            <span className="text-black/40 text-xs">%</span>
          </div>
          {aviso && <p className="text-xs text-[#B82D25]">{aviso}</p>}
          <Acciones cerrar={cerrar} okLabel="Registrar recepción" onOk={() => post({ accion: 'recibir', id: modal.oc.id, margenPct: f.margenPct ? Number(f.margenPct) : undefined, items: (modal.oc.items ?? []).map((it: any) => ({ sku: it.producto?.sku, cantidad: Number(recibido[it.producto?.sku] ?? (Number(it.cantidad) - Number(it.cantidad_recibida ?? 0))) })).filter((x: any) => x.cantidad > 0) })} />
        </>)}

        {t === 'proveedor' && (<>
          <h2 className="font-semibold text-black text-lg">{modal.prov?.id ? 'Editar proveedor' : 'Nuevo proveedor'}</h2>
          <input value={f.razon_social ?? f.razonSocial ?? ''} onChange={(e) => set('razonSocial', e.target.value)} placeholder="Razón social" className={input} />
          <div className="grid grid-cols-2 gap-3">
            <input value={f.cuit ?? ''} onChange={(e) => set('cuit', e.target.value)} placeholder="CUIT" className={input} />
            <input value={f.condicion_pago ?? f.condicionPago ?? ''} onChange={(e) => set('condicionPago', e.target.value)} placeholder="Condición (30 días…)" className={input} />
            <input value={f.email ?? ''} onChange={(e) => set('email', e.target.value)} placeholder="Email" className={input} />
            <input type="number" value={f.lead_time_dias ?? f.leadTimeDias ?? ''} onChange={(e) => set('leadTimeDias', e.target.value)} placeholder="Días de entrega" className={input} />
          </div>
          {aviso && <p className="text-xs text-[#B82D25]">{aviso}</p>}
          <Acciones cerrar={cerrar} okLabel="Guardar" onOk={() => post(modal.prov?.id ? { accion: 'editarProveedor', id: modal.prov.id, razonSocial: f.razonSocial ?? f.razon_social, cuit: f.cuit, condicionPago: f.condicionPago ?? f.condicion_pago, email: f.email, leadTimeDias: f.leadTimeDias ?? f.lead_time_dias } : { accion: 'crearProveedor', razonSocial: f.razonSocial, cuit: f.cuit, condicionPago: f.condicionPago, email: f.email, leadTimeDias: f.leadTimeDias })} />
        </>)}

        {t === 'factura' && (<>
          <h2 className="font-semibold text-black text-lg">Registrar factura de proveedor</h2>
          <select className={input + ' bg-white'} value={f.proveedorId ?? ''} onChange={(e) => set('proveedorId', e.target.value)}>
            <option value="">Proveedor…</option>{proveedores.map((p: any) => <option key={p.id} value={p.id}>{p.razon_social}</option>)}
          </select>
          <div className="grid grid-cols-2 gap-3">
            <input value={f.numero ?? ''} onChange={(e) => set('numero', e.target.value)} placeholder="N° de factura" className={input} />
            <input type="number" value={f.monto ?? ''} onChange={(e) => set('monto', e.target.value)} placeholder="Monto $" className={input} />
          </div>
          <input type="date" value={f.vencimiento ?? ''} onChange={(e) => set('vencimiento', e.target.value)} className={input} />
          {aviso && <p className="text-xs text-[#B82D25]">{aviso}</p>}
          <Acciones cerrar={cerrar} okLabel="Registrar" onOk={() => post({ accion: 'factura', proveedorId: f.proveedorId, numero: f.numero, monto: Number(f.monto), vencimiento: f.vencimiento })} />
        </>)}

        {t === 'pagar' && (<>
          <h2 className="font-semibold text-black text-lg">Nueva orden de pago — {modal.prov.proveedor?.razon_social}</h2>
          <p className="text-xs text-black/50">Elegí las facturas. La OP queda <b>pendiente de aprobación del dueño</b> antes de pagarse.</p>
          {modal.prov.facturas.map((fa: any) => (
            <label key={fa.id} className="flex items-center gap-2 text-sm text-black border-b border-black/5 py-1.5">
              <input type="checkbox" checked={facturasSel.includes(fa.id)} onChange={(e) => setFacturasSel((s) => e.target.checked ? [...s, fa.id] : s.filter((x) => x !== fa.id))} className="accent-[#B82D25]" />
              <span className="flex-1">Factura {fa.numero} {fa.vencimiento ? `· vence ${fecha(fa.vencimiento)}` : ''}</span>
              <span className="font-medium">{pesos(fa.monto)}</span>
            </label>
          ))}
          <div className="grid grid-cols-2 gap-3">
            <select className={input + ' bg-white'} value={f.medioPago ?? 'transferencia'} onChange={(e) => set('medioPago', e.target.value)}>
              <option value="transferencia">Transferencia</option><option value="cheque">Cheque</option><option value="efectivo">Efectivo</option>
            </select>
            <div><label className="text-[11px] text-black/45 block mb-0.5">Pago programado</label><input type="date" value={f.fechaProgramada ?? ''} onChange={(e) => set('fechaProgramada', e.target.value)} className={input} /></div>
          </div>
          <input value={f.observaciones ?? ''} onChange={(e) => set('observaciones', e.target.value)} placeholder="Observaciones (opcional)" className={input} />
          {facturasSel.length > 0 && <p className="text-right text-sm font-semibold">Total OP: {pesos(modal.prov.facturas.filter((x: any) => facturasSel.includes(x.id)).reduce((s: number, x: any) => s + Number(x.monto), 0))}</p>}
          {aviso && <p className="text-xs text-[#B82D25]">{aviso}</p>}
          <Acciones cerrar={cerrar} okLabel="Crear orden de pago" disabled={!facturasSel.length} onOk={() => post({ accion: 'crearOP', facturaIds: facturasSel, medioPago: f.medioPago ?? 'transferencia', fechaProgramada: f.fechaProgramada, observaciones: f.observaciones })} />
        </>)}
      </div>
    </div>
  );
}

function Acciones({ cerrar, onOk, okLabel, disabled }: any) {
  const [cargando, setCargando] = useState(false);
  return (
    <div className="flex justify-end gap-3 pt-1">
      <button onClick={cerrar} className="text-sm text-black/60 px-4 py-2 hover:text-black">Cancelar</button>
      <button onClick={async () => { setCargando(true); try { await onOk(); } finally { setCargando(false); } }} disabled={disabled || cargando} className="rounded-full bg-[#B82D25] text-white text-sm font-medium px-6 py-2.5 hover:bg-[#932A1F] disabled:opacity-50">{cargando ? '…' : okLabel}</button>
    </div>
  );
}
