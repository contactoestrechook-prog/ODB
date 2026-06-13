'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { BotonAnular } from './BotonAnular';

const pesos = (n: any) => '$' + Math.round(Number(n) || 0).toLocaleString('es-AR');
const MEDIO_LABEL: Record<string, string> = { efectivo: 'Efectivo', mercadopago: 'Mercado Pago', tarjeta: 'Tarjeta', cta_cte: 'Cuenta corriente' };

const TABS = [['dia', 'Del día'], ['sucursal', 'Por sucursal'], ['medios', 'Medios de pago'], ['anuladas', 'Anuladas'], ['buscar', 'Buscar ticket']] as const;

export function VentasWorkspace({ resumen, ventas, sucursales }: { resumen: any; ventas: any[]; sucursales: any[] }) {
  const [tab, setTab] = useState('dia');
  const [lista, setLista] = useState<any[]>(ventas);
  const [cargando, setCargando] = useState(false);
  const [sucursalId, setSucursalId] = useState('');
  const [medio, setMedio] = useState('');
  const [buscar, setBuscar] = useState('');

  const cargar = async (qs: string) => {
    setCargando(true);
    try { const r = await fetch(`/api/ventas?${qs}`); const d = await r.json(); setLista(Array.isArray(d) ? d : []); }
    finally { setCargando(false); }
  };

  useEffect(() => {
    if (tab === 'dia') setLista(ventas);
    if (tab === 'sucursal') cargar(`limite=50${sucursalId ? `&sucursalId=${sucursalId}` : ''}`);
    if (tab === 'medios') cargar(`limite=50${medio ? `&medioPago=${medio}` : ''}`);
    if (tab === 'anuladas') cargar('estado=anulada&limite=50');
  }, [tab, sucursalId, medio]);

  return (
    <div className="space-y-5">
      {/* KPIs de hoy */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[['Facturado hoy', pesos(resumen?.facturado)], ['Tickets', resumen?.tickets ?? 0], ['Ticket promedio', pesos(resumen?.ticketPromedio)], ['Descuentos', pesos(resumen?.descuentos)]].map(([l, v]: any, i) => (
          <div key={l} className={`rounded-xl p-4 ${i === 3 ? 'bg-[#B82D25] text-white' : 'bg-white'}`}>
            <p className={`text-xs ${i === 3 ? 'text-white/80' : 'text-black/50'}`}>{l}</p>
            <p className={`text-xl font-semibold ${i === 3 ? 'text-white' : 'text-black'}`}>{v}</p>
          </div>
        ))}
      </div>

      <div className="flex gap-1.5 flex-wrap border-b border-black/10">
        {TABS.map(([k, label]) => <button key={k} onClick={() => setTab(k)} className={`px-3.5 py-2 text-sm font-medium rounded-t-lg -mb-px border-b-2 ${tab === k ? 'border-[#B82D25] text-black' : 'border-transparent text-black/45 hover:text-black'}`}>{label}</button>)}
      </div>

      {/* desgloses */}
      {tab === 'sucursal' && (
        <div className="grid sm:grid-cols-3 gap-3">
          <button onClick={() => setSucursalId('')} className={`rounded-xl p-4 text-left border ${!sucursalId ? 'border-[#B82D25] bg-white' : 'border-black/[0.04] bg-white'}`}>
            <p className="text-sm font-medium text-black">Todas</p><p className="text-xs text-black/45">{resumen?.tickets ?? 0} tickets hoy</p>
          </button>
          {sucursales.map((s) => {
            const r = resumen?.porSucursal?.[s.nombre];
            return <button key={s.id} onClick={() => setSucursalId(s.id)} className={`rounded-xl p-4 text-left border ${sucursalId === s.id ? 'border-[#B82D25] bg-white' : 'border-black/[0.04] bg-white'}`}>
              <p className="text-sm font-medium text-black">{s.nombre}</p><p className="text-lg font-semibold text-black mt-1">{pesos(r?.facturado ?? 0)}</p><p className="text-xs text-black/45">{r?.tickets ?? 0} tickets hoy</p>
            </button>;
          })}
        </div>
      )}

      {tab === 'medios' && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {Object.entries(MEDIO_LABEL).map(([k, label]) => (
            <button key={k} onClick={() => setMedio(medio === k ? '' : k)} className={`rounded-xl p-4 text-left border ${medio === k ? 'border-[#B82D25] bg-white' : 'border-black/[0.04] bg-white'}`}>
              <p className="text-sm font-medium text-black">{label}</p>
              <p className="text-lg font-semibold text-black mt-1">{pesos(resumen?.porMedio?.[k] ?? 0)}</p>
              <p className="text-xs text-black/45">hoy</p>
            </button>
          ))}
        </div>
      )}

      {tab === 'buscar' && (
        <form onSubmit={(e) => { e.preventDefault(); cargar(`buscar=${encodeURIComponent(buscar)}&limite=50`); }} className="flex gap-2">
          <input value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="N° de ticket, DNI o nombre del cliente…" className="flex-1 rounded-full border border-[#B82D25] bg-white px-4 py-2 text-sm text-black outline-none" />
          <button className="rounded-full bg-[#B82D25] text-white text-sm font-medium px-5 py-2 hover:bg-[#932A1F]">Buscar</button>
        </form>
      )}

      {/* listado */}
      <section className="rounded-xl bg-white overflow-hidden">
        <h2 className="px-4 py-3 border-b border-black/10 font-medium text-black text-sm">
          {tab === 'anuladas' ? 'Ventas anuladas' : tab === 'buscar' ? 'Resultados' : 'Operaciones'}{!cargando && ` (${lista.length})`}
        </h2>
        {cargando ? <p className="px-4 py-8 text-center text-black/40 text-sm">Cargando…</p>
          : lista.length === 0 ? <p className="px-4 py-8 text-center text-black/40 text-sm">{tab === 'anuladas' ? 'No hay ventas anuladas.' : 'Sin ventas para este filtro.'}</p>
          : (
          <table className="w-full text-sm text-black">
            <tbody>
              {lista.map((v) => (
                <tr key={v.id} className={`border-b border-black/5 last:border-0 ${v.estado === 'anulada' ? 'opacity-50' : ''}`}>
                  <td className="px-4 py-3 align-top w-32">
                    <p className="text-xs text-black/50">{new Date(v.vendida_en).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })} {new Date(v.vendida_en).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}</p>
                    <p className="text-xs text-black/40">{v.sucursal?.nombre}</p>
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-sm">{(v.items ?? []).slice(0, 3).map((i: any) => `${i.producto?.nombre ?? '—'} ×${Math.round(Number(i.cantidad))}`).join(' · ')}{(v.items ?? []).length > 3 ? ` +${v.items.length - 3}` : ''}</p>
                    <p className="text-xs text-black/45">{(v.pagos ?? []).map((p: any) => `${MEDIO_LABEL[p.medio] ?? p.medio} ${pesos(p.monto)}`).join(' + ')}{v.cliente?.dni ? ` · ${v.cliente?.nombre ?? 'DNI ' + v.cliente.dni}` : ''}</p>
                  </td>
                  <td className="px-4 py-3 text-right align-top whitespace-nowrap">
                    <p className="font-medium">{pesos(v.total)}</p>
                    {v.estado === 'anulada' ? <span className="text-xs text-black/40">anulada · NC</span> : (
                      <span className="inline-flex items-center gap-2 mt-1">
                        <Link href={`/facturacion?venta=${v.id}&total=${v.total}`} className="rounded-full border border-black/15 px-3 py-1 text-xs text-black hover:border-black/40">Facturar</Link>
                        <BotonAnular ventaId={v.id} total={v.total} />
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
