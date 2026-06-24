'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

const pesos = (n: any) => '$' + Math.round(Number(n) || 0).toLocaleString('es-AR');

export function EnvasesWorkspace({ resumen, saldos, tipos }: { resumen: any; saldos: any[]; tipos: any[] }) {
  const router = useRouter();
  const [modal, setModal] = useState<any>(null);
  const [aviso, setAviso] = useState('');
  const [detalle, setDetalle] = useState<any>(null);

  const post = async (body: any) => {
    setAviso('');
    const r = await fetch('/api/envases', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const d = await r.json();
    if (!r.ok) { setAviso(d.message ?? 'Error'); return null; }
    setModal(null); router.refresh();
    return d;
  };
  const verDetalle = async (id: string, nombre: string) => {
    const r = await fetch(`/api/envases?recurso=cliente&id=${id}`);
    if (r.ok) setDetalle({ nombre, ...(await r.json()) });
  };

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex gap-7 flex-wrap">
          {[
            ['Envases en la calle', resumen?.enCalleTotal ?? 0],
            ['Valor en la calle', pesos(resumen?.valorTotal), 'text-[#B82D25]'],
            ['Clientes con saldo', resumen?.clientesConSaldo ?? 0],
            ['Tipos de envase', tipos.length],
          ].map(([l, v, c]: any) => (
            <div key={l}><p className={`text-xl font-semibold leading-none ${c || 'text-black'}`}>{v}</p><p className="text-[11px] text-black/45 mt-1">{l}</p></div>
          ))}
        </div>
        <button onClick={() => setModal({ tipo: 'mov', sentido: 'entrega' })} className="rounded-full bg-[#B82D25] text-white text-sm font-medium px-5 py-2.5 hover:bg-[#932A1F]">+ Registrar movimiento</button>
      </div>

      {aviso && <p className="rounded-lg bg-white p-3 text-sm text-[#B82D25]">{aviso}</p>}

      {/* En la calle por tipo */}
      <section className="rounded-xl bg-white overflow-hidden">
        <h2 className="px-4 py-3 border-b border-black/10 font-medium text-black text-sm flex items-center justify-between">
          Envases en la calle por tipo
          <button onClick={() => setModal({ tipo: 'nuevoTipo' })} className="text-xs text-[#B82D25] hover:underline">+ Tipo de envase</button>
        </h2>
        <table className="w-full text-sm text-black">
          <thead><tr className="text-left text-xs text-black/50 border-b border-black/5"><th className="px-4 py-2 font-medium">Envase</th><th className="px-4 py-2 font-medium text-right">Valor c/u</th><th className="px-4 py-2 font-medium text-right">En la calle</th><th className="px-4 py-2 font-medium text-right">Valor total</th></tr></thead>
          <tbody>
            {(resumen?.tipos ?? []).map((t: any) => (
              <tr key={t.tipo_id} className="border-b border-black/5 last:border-0">
                <td className="px-4 py-2.5 font-medium">{t.nombre}</td>
                <td className="px-4 py-2.5 text-right text-black/60">{pesos(t.valor)}</td>
                <td className="px-4 py-2.5 text-right font-medium">{Number(t.en_calle)}</td>
                <td className="px-4 py-2.5 text-right text-[#B82D25] font-medium">{pesos(Number(t.en_calle) * Number(t.valor))}</td>
              </tr>
            ))}
            {(resumen?.tipos ?? []).length === 0 && <tr><td colSpan={4} className="px-4 py-6 text-center text-black/40 text-sm">Sin tipos de envase. Agregá el primero.</td></tr>}
          </tbody>
        </table>
      </section>

      {/* Saldos por cliente */}
      <section className="rounded-xl bg-white overflow-hidden">
        <h2 className="px-4 py-3 border-b border-black/10 font-medium text-black text-sm">Clientes con envases ({saldos.length})</h2>
        {saldos.length === 0 ? <p className="px-4 py-8 text-center text-black/40 text-sm">Ningún cliente tiene envases en su poder. Registrá un movimiento de entrega.</p> : (
          <div className="divide-y divide-black/5">
            {saldos.map((s) => (
              <button key={s.cliente_id} onClick={() => verDetalle(s.cliente_id, s.nombre)} className="w-full text-left px-4 py-3 flex items-center justify-between hover:bg-[#F0EBE2]/40">
                <div><p className="font-medium text-black text-sm">{s.nombre}</p><p className="text-xs text-black/45">{Number(s.total)} envase(s) · ver detalle</p></div>
                <span className="font-semibold text-[#B82D25]">{pesos(s.valor)}</span>
              </button>
            ))}
          </div>
        )}
      </section>

      {modal && <Modal modal={modal} setModal={setModal} post={post} tipos={tipos} aviso={aviso} />}
      {detalle && <DetalleModal detalle={detalle} cerrar={() => setDetalle(null)} />}
    </div>
  );
}

function Modal({ modal, setModal, post, tipos, aviso }: any) {
  const t = modal.tipo;
  const [f, setF] = useState<any>(modal);
  const set = (k: string, v: any) => setF((x: any) => ({ ...x, [k]: v }));
  const [busca, setBusca] = useState('');
  const [sug, setSug] = useState<any[]>([]);
  const [cli, setCli] = useState<any>(null);

  useEffect(() => {
    if (busca.trim().length < 2) return setSug([]);
    const tm = setTimeout(async () => { const r = await fetch(`/api/envases?recurso=buscarCliente&q=${encodeURIComponent(busca)}`); if (r.ok) setSug((await r.json()).slice(0, 6)); }, 250);
    return () => clearTimeout(tm);
  }, [busca]);

  const input = 'w-full rounded-lg border border-black/15 px-3 py-2.5 text-sm';
  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-[2px] flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl w-full max-w-md p-6 space-y-3 shadow-2xl">
        {t === 'nuevoTipo' && (<>
          <h2 className="font-semibold text-black text-lg">Nuevo tipo de envase</h2>
          <input className={input} placeholder="Nombre (ej. Sifón soda)" value={f.nombre ?? ''} onChange={(e) => set('nombre', e.target.value)} />
          <input className={input} type="number" placeholder="Valor del envase $" value={f.valor ?? ''} onChange={(e) => set('valor', e.target.value)} />
          {aviso && <p className="text-xs text-[#B82D25]">{aviso}</p>}
          <Acciones cerrar={() => setModal(null)} okLabel="Guardar" onOk={() => post({ accion: 'tipo', nombre: f.nombre, valor: Number(f.valor) || 0 })} />
        </>)}

        {t === 'mov' && (<>
          <h2 className="font-semibold text-black text-lg">Movimiento de envases</h2>
          <div className="flex gap-2">
            {(['entrega', 'devolucion'] as const).map((s) => (
              <button key={s} onClick={() => set('sentido', s)} className={`flex-1 rounded-lg py-2 text-sm font-medium border ${f.sentido === s ? (s === 'entrega' ? 'bg-[#B82D25] text-white border-[#B82D25]' : 'bg-emerald-600 text-white border-emerald-600') : 'border-black/15 text-black/60'}`}>{s === 'entrega' ? 'Entrega (se lleva)' : 'Devolución (trae)'}</button>
            ))}
          </div>
          {cli ? (
            <div className="flex items-center justify-between rounded-lg bg-[#F0EBE2] px-3 py-2 text-sm"><span>{cli.nombre ?? cli.razon_social ?? cli.dni}</span><button onClick={() => { setCli(null); setBusca(''); }} className="text-black/40 hover:text-[#B82D25]">cambiar</button></div>
          ) : (
            <div className="relative">
              <input className={input} placeholder="Buscar cliente (nombre/DNI)…" value={busca} onChange={(e) => setBusca(e.target.value)} />
              {sug.length > 0 && <div className="absolute z-10 mt-1 w-full rounded-lg bg-white shadow-lg border border-black/10 max-h-44 overflow-y-auto">
                {sug.map((c: any) => <button key={c.id} onClick={() => { setCli(c); set('clienteId', c.id); setSug([]); }} className="w-full text-left px-3 py-2 text-sm hover:bg-[#F0EBE2] border-b border-black/5 last:border-0">{c.nombre ?? c.razon_social ?? c.dni}</button>)}
              </div>}
            </div>
          )}
          <select className={input + ' bg-white'} value={f.tipoId ?? ''} onChange={(e) => set('tipoId', e.target.value)}>
            <option value="">Tipo de envase…</option>{tipos.map((tp: any) => <option key={tp.id} value={tp.id}>{tp.nombre}</option>)}
          </select>
          <input className={input} type="number" placeholder="Cantidad" value={f.cantidad ?? ''} onChange={(e) => set('cantidad', e.target.value)} />
          {aviso && <p className="text-xs text-[#B82D25]">{aviso}</p>}
          <Acciones cerrar={() => setModal(null)} okLabel="Registrar" disabled={!f.clienteId || !f.tipoId || !f.cantidad} onOk={() => post({ accion: 'movimiento', clienteId: f.clienteId, tipoId: f.tipoId, cantidad: Number(f.cantidad), sentido: f.sentido })} />
        </>)}
      </div>
    </div>
  );
}

function DetalleModal({ detalle, cerrar }: any) {
  const fecha = (iso: string) => new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' });
  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-[2px] flex items-center justify-center p-4 z-50" onClick={cerrar}>
      <div className="bg-white rounded-2xl w-full max-w-md p-6 space-y-3 shadow-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-semibold text-black text-lg">{detalle.nombre}</h2>
        <div className="space-y-1">
          {(detalle.saldos ?? []).map((s: any) => (
            <div key={s.nombre} className="flex justify-between text-sm"><span className="text-black/70">{s.nombre}</span><span className="font-medium">{s.saldo} en su poder</span></div>
          ))}
        </div>
        <h3 className="text-xs text-black/50 pt-2 border-t border-black/10">Movimientos</h3>
        <div className="space-y-1">
          {(detalle.movimientos ?? []).map((m: any, i: number) => (
            <div key={i} className="flex justify-between text-sm"><span className="text-black/70">{fecha(m.creado_en)} · {m.tipo?.nombre}</span><span className={Number(m.cantidad) > 0 ? 'text-[#B82D25]' : 'text-emerald-700'}>{Number(m.cantidad) > 0 ? '+' : ''}{m.cantidad}</span></div>
          ))}
        </div>
        <button onClick={cerrar} className="w-full rounded-full bg-black text-white text-sm font-medium py-2.5 mt-2">Cerrar</button>
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
