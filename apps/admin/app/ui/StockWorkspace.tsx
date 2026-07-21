'use client';

import { useEffect, useState } from 'react';
import { AccionesStock } from './AccionesStock';
import { BotonPromo } from './BotonPromo';

const pesos = (n: any) => '$' + Math.round(Number(n) || 0).toLocaleString('es-AR');
const num = (n: any) => Math.round(Number(n) || 0).toLocaleString('es-AR');
const fecha = (iso: string) => (iso ? new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—');

const MOV_LABEL: Record<string, string> = {
  venta: 'Venta', devolucion: 'Devolución', compra: 'Compra', ajuste: 'Ajuste', merma: 'Merma',
  transferencia_salida: 'Transf. salida', transferencia_entrada: 'Transf. entrada',
  reserva: 'Reserva', liberacion_reserva: 'Reserva liberada',
};

const TABS = [
  ['resumen', 'Resumen'], ['reposicion', 'Reposición'], ['vencimientos', 'Vencimientos'],
  ['negativos', 'Stock negativo'], ['rotacion', 'Sin rotación'], ['abc', 'Análisis ABC'],
  ['movimientos', 'Movimientos'],
] as const;

export function StockWorkspace({
  resumen, valorizacion, criticos, vencimientos, sucursales, transferencias,
}: {
  resumen: any; valorizacion: any; criticos: any[]; vencimientos: any; sucursales: any[]; transferencias: any[];
}) {
  const [tab, setTab] = useState('resumen');
  const [data, setData] = useState<Record<string, any>>({});
  const [cargando, setCargando] = useState(false);
  const [movFiltro, setMovFiltro] = useState({ tipo: '', sucursalId: '', dias: '', sku: '' });
  // consulta puntual de stock por producto (cuando se entra con ?sku= desde Estadísticas)
  const [consulta, setConsulta] = useState<any>(null);

  async function cargar(recurso: string, qs = '') {
    setCargando(true);
    try {
      const res = await fetch(`/api/stock?recurso=${recurso}${qs}`);
      const d = await res.json();
      setData((x) => ({ ...x, [recurso]: d }));
    } finally {
      setCargando(false);
    }
  }

  async function consultarProducto(sku: string) {
    const res = await fetch(`/api/pos-stock?q=${encodeURIComponent(sku)}`);
    if (res.ok) { const d = await res.json(); setConsulta(Array.isArray(d) ? d.find((p: any) => p.sku === sku) ?? d[0] : null); }
  }

  // deep-link desde Estadísticas: /stock?sku=XXX → va a Movimientos filtrado por ese producto y muestra su stock
  useEffect(() => {
    const sku = new URLSearchParams(window.location.search).get('sku');
    if (sku) {
      setMovFiltro((f) => ({ ...f, sku }));
      setTab('movimientos');
      consultarProducto(sku);
      cargar('movimientos', `&limite=150&sku=${encodeURIComponent(sku)}`);
    }
  }, []);

  useEffect(() => {
    if (tab === 'negativos' && !data['negativos']) cargar('negativos');
    if (tab === 'abc' && !data['abc']) cargar('abc');
    if (tab === 'rotacion' && !data['sin-rotacion']) cargar('sin-rotacion', '&dias=30');
    if (tab === 'movimientos' && !data['movimientos'] && !movFiltro.sku) cargar('movimientos', '&limite=100');
  }, [tab]);

  const aplicarMovFiltro = () => {
    const qs = `&limite=150${movFiltro.tipo ? `&tipo=${movFiltro.tipo}` : ''}${movFiltro.sucursalId ? `&sucursalId=${movFiltro.sucursalId}` : ''}${movFiltro.dias ? `&dias=${movFiltro.dias}` : ''}${movFiltro.sku ? `&sku=${encodeURIComponent(movFiltro.sku)}` : ''}`;
    if (movFiltro.sku) consultarProducto(movFiltro.sku); else setConsulta(null);
    cargar('movimientos', qs);
  };

  const r = resumen ?? {};
  const valorMax = Math.max(...(valorizacion?.rubros ?? []).map((x: any) => Number(x.valor)), 1);

  return (
    <div className="space-y-5">
      <AccionesStock sucursales={sucursales} transferencias={transferencias} />

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          ['Valor inventario', pesos(r.valor_inventario)],
          ['SKUs activos', num(r.skus_activos)],
          ['Unidades', num(r.unidades)],
          ['Con stock', num(r.con_stock)],
          ['Bajo reposición', num(r.bajo_reposicion), r.bajo_reposicion > 0 ? 'text-[#B82D25]' : ''],
          ['Negativos', num(r.negativos), r.negativos > 0 ? 'text-[#B82D25]' : ''],
        ].map(([lbl, val, cls]: any) => (
          <div key={lbl} className="rounded-xl bg-white p-3.5 border border-black/[0.04]">
            <p className={`text-lg font-semibold leading-none ${cls || 'text-black'}`}>{val}</p>
            <p className="text-[11px] text-black/45 mt-1">{lbl}</p>
          </div>
        ))}
      </div>

      {/* pestañas */}
      <div className="flex gap-1.5 flex-wrap border-b border-black/10">
        {TABS.map(([k, label]) => {
          const badge = k === 'reposicion' ? criticos.length : k === 'vencimientos' ? (vencimientos?.lotes?.length ?? 0) : k === 'negativos' ? r.negativos : 0;
          return (
            <button key={k} onClick={() => setTab(k)}
              className={`px-3.5 py-2 text-sm font-medium rounded-t-lg -mb-px border-b-2 ${tab === k ? 'border-[#B82D25] text-black' : 'border-transparent text-black/45 hover:text-black'}`}>
              {label}{badge ? <span className="ml-1.5 text-[10px] rounded-full bg-[#B82D25] text-white px-1.5 py-0.5">{badge}</span> : ''}
            </button>
          );
        })}
      </div>

      {/* RESUMEN: valorización por rubro y sucursal */}
      {tab === 'resumen' && (
        <div className="grid lg:grid-cols-2 gap-4">
          <section className="rounded-xl bg-white overflow-hidden">
            <h2 className="px-4 py-3 border-b border-black/10 font-medium text-black text-sm">Valor por rubro (top 12)</h2>
            <div className="p-4 space-y-2">
              {(valorizacion?.rubros ?? []).slice(0, 12).map((x: any) => (
                <div key={x.rubro}>
                  <div className="flex justify-between text-xs text-black mb-1">
                    <span>{x.rubro} <span className="text-black/40">· {x.skus} SKUs</span></span>
                    <span className="font-medium">{pesos(x.valor)}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-[#F0EBE2]">
                    <div className="h-1.5 rounded-full bg-[#B82D25]" style={{ width: `${Math.max((Number(x.valor) / valorMax) * 100, 2)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </section>
          <section className="rounded-xl bg-white overflow-hidden h-fit">
            <h2 className="px-4 py-3 border-b border-black/10 font-medium text-black text-sm">Valor por sucursal</h2>
            <div className="p-4 space-y-3">
              {(valorizacion?.sucursales ?? []).map((s: any) => (
                <div key={s.sucursal} className="flex justify-between items-baseline">
                  <div>
                    <p className="text-sm font-medium text-black">{s.sucursal}</p>
                    <p className="text-xs text-black/45">{s.skus} SKUs · {num(s.unidades)} u.</p>
                  </div>
                  <p className="text-lg font-semibold text-black">{pesos(s.valor)}</p>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}

      {/* REPOSICIÓN */}
      {tab === 'reposicion' && (
        <Tabla titulo={`Bajo punto de reposición (${criticos.length})`} vacio="Ningún producto por debajo de su punto de reposición."
          filas={criticos} cols={['Producto', 'Sucursal', 'Stock', 'Mínimo', 'Reposición']}
          render={(c: any) => (
            <tr key={`${c.sku}-${c.sucursal}`} className="border-b border-black/5 last:border-0">
              <td className="px-4 py-3"><p className="font-medium">{c.producto}</p><p className="text-xs text-black/50">{c.sku}</p></td>
              <td className="px-4 py-3 text-black/70">{c.sucursal}</td>
              <td className="px-4 py-3 text-right"><span className="rounded-full bg-[#B82D25] px-2.5 py-0.5 text-xs font-medium text-white">{num(c.cantidad)}</span></td>
              <td className="px-4 py-3 text-right text-black/70">{num(c.stock_minimo)}</td>
              <td className="px-4 py-3 text-right text-black/70">{num(c.punto_reposicion)}</td>
            </tr>
          )} />
      )}

      {/* VENCIMIENTOS */}
      {tab === 'vencimientos' && (
        <Tabla titulo="Vencimientos próximos (45 días)" vacio="Sin vencimientos próximos."
          extra={vencimientos?.capitalEnRiesgo ? <span className="text-xs text-[#932A1F] font-medium">{pesos(vencimientos.capitalEnRiesgo)} en riesgo</span> : null}
          filas={vencimientos?.lotes ?? []} cols={['Producto', 'Sucursal', 'Vence', 'Unidades', 'Acción']}
          render={(l: any, i: number) => (
            <tr key={i} className="border-b border-black/5 last:border-0">
              <td className="px-4 py-2.5"><p className="font-medium">{l.producto}</p><p className="text-xs text-black/40">{l.sku} · lote {l.lote}</p></td>
              <td className="px-4 py-2.5 text-black/70">{l.sucursal}</td>
              <td className="px-4 py-2.5 text-right">
                <span className={'rounded-full px-2.5 py-0.5 text-xs font-medium ' + (l.estado === 'vencido' || l.estado === 'critico' ? 'bg-[#B82D25] text-white' : l.estado === 'pronto' ? 'bg-black text-white' : 'bg-[#F0EBE2] text-black')}>
                  {l.estado === 'vencido' ? 'VENCIDO' : `${l.dias} días`}
                </span>
              </td>
              <td className="px-4 py-2.5 text-right text-black/70">{l.cantidad}</td>
              <td className="px-4 py-2.5 text-right text-xs">
                {l.estado === 'vencido' ? <span className="text-[#932A1F] font-medium">retirar / merma</span>
                  : l.descuentoSugerido ? <BotonPromo sku={l.sku} nombre={l.producto} porcentaje={l.descuentoSugerido} />
                  : <span className="text-black/40">vigilar</span>}
              </td>
            </tr>
          )} />
      )}

      {/* NEGATIVOS */}
      {tab === 'negativos' && (
        cargando && !data['negativos'] ? <Cargando /> :
        <Tabla titulo={`Stock negativo (${(data['negativos'] ?? []).length})`}
          vacio="✓ No hay stock negativo. El inventario está sano."
          filas={data['negativos'] ?? []} cols={['Producto', 'Sucursal', 'Stock', 'Capital']}
          render={(n: any, i: number) => (
            <tr key={i} className="border-b border-black/5 last:border-0">
              <td className="px-4 py-3"><p className="font-medium">{n.producto}</p><p className="text-xs text-black/50">{n.sku}</p></td>
              <td className="px-4 py-3 text-black/70">{n.sucursal}</td>
              <td className="px-4 py-3 text-right"><span className="rounded-full bg-[#B82D25] px-2.5 py-0.5 text-xs font-medium text-white">{n.cantidad}</span></td>
              <td className="px-4 py-3 text-right text-black/60">{pesos(Number(n.cantidad) * Number(n.costo))}</td>
            </tr>
          )} />
      )}

      {/* SIN ROTACIÓN */}
      {tab === 'rotacion' && (
        cargando && !data['sin-rotacion'] ? <Cargando /> :
        <Tabla titulo="Sin rotación — con stock pero sin ventas en 30 días (capital dormido)"
          vacio="Todo el stock rotó en los últimos 30 días."
          filas={data['sin-rotacion'] ?? []} cols={['Producto', 'Unidades', 'Capital dormido', 'Última venta']}
          render={(x: any, i: number) => (
            <tr key={i} className="border-b border-black/5 last:border-0">
              <td className="px-4 py-3"><p className="font-medium">{x.producto}</p><p className="text-xs text-black/50">{x.sku}</p></td>
              <td className="px-4 py-3 text-right text-black/70">{num(x.unidades)}</td>
              <td className="px-4 py-3 text-right font-medium text-[#932A1F]">{pesos(x.capital)}</td>
              <td className="px-4 py-3 text-right text-xs text-black/50">{x.ultima_venta ? fecha(x.ultima_venta) : 'nunca'}</td>
            </tr>
          )} />
      )}

      {/* ABC */}
      {tab === 'abc' && (
        cargando && !data['abc'] ? <Cargando /> : (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              {[['A', 'Generan el 80% de la venta', 'bg-black text-white'], ['B', 'El siguiente 15%', 'bg-[#B82D25] text-white'], ['C', 'El último 5% (cola larga)', 'bg-[#F0EBE2] text-black']].map(([clase, desc, cls]) => {
                const n = (data['abc'] ?? []).filter((x: any) => x.clase === clase).length;
                return (
                  <div key={clase} className="rounded-xl bg-white p-4 border border-black/[0.04]">
                    <span className={`text-xs font-bold rounded-full px-2 py-0.5 ${cls}`}>Clase {clase}</span>
                    <p className="text-2xl font-semibold text-black mt-2">{n}</p>
                    <p className="text-[11px] text-black/45">{desc}</p>
                  </div>
                );
              })}
            </div>
            <Tabla titulo="Productos por facturación (30 días)" vacio="Sin ventas en el período."
              filas={data['abc'] ?? []} cols={['Clase', 'Producto', 'Facturado 30d', 'Acumulado']}
              render={(x: any, i: number) => (
                <tr key={i} className="border-b border-black/5 last:border-0">
                  <td className="px-4 py-2.5"><span className={`text-[11px] font-bold rounded-full px-2 py-0.5 ${x.clase === 'A' ? 'bg-black text-white' : x.clase === 'B' ? 'bg-[#B82D25] text-white' : 'bg-[#F0EBE2] text-black'}`}>{x.clase}</span></td>
                  <td className="px-4 py-2.5"><p className="font-medium">{x.producto}</p><p className="text-xs text-black/40">{x.sku}</p></td>
                  <td className="px-4 py-2.5 text-right font-medium">{pesos(x.facturado)}</td>
                  <td className="px-4 py-2.5 text-right text-xs text-black/50">{x.acum_pct}%</td>
                </tr>
              )} />
          </div>
        )
      )}

      {/* MOVIMIENTOS (kardex con filtros) */}
      {tab === 'movimientos' && (
        <div className="space-y-3">
          {/* stock del producto consultado (deep-link desde Estadísticas) */}
          {consulta && (
            <div className="rounded-xl bg-white p-4 border border-black/[0.06]">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold text-black">{consulta.nombre}</p>
                  <p className="text-xs text-black/45">{consulta.sku}{consulta.codigo ? ` · ${consulta.codigo}` : ''}</p>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-semibold text-black tabular-nums leading-none">{num(consulta.total)}</p>
                  <p className="text-xs text-black/45">unidades en total</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 mt-3">
                {(consulta.sucursales ?? []).map((s: any) => (
                  <span key={s.sucursal} className={`text-xs rounded-full px-3 py-1 ${Number(s.cantidad) < 0 ? 'bg-[#B82D25]/12 text-[#B82D25]' : 'bg-[#F0EBE2] text-black/70'}`}>
                    {s.sucursal}: <b>{num(s.cantidad)}</b>
                  </span>
                ))}
              </div>
            </div>
          )}
          <div className="flex flex-wrap gap-2 items-center">
            <input value={movFiltro.sku} onChange={(e) => setMovFiltro((f) => ({ ...f, sku: e.target.value }))} placeholder="SKU / producto" className="rounded-lg border border-black/15 bg-white px-2.5 py-2 text-sm text-black w-36" />
            <select value={movFiltro.tipo} onChange={(e) => setMovFiltro((f) => ({ ...f, tipo: e.target.value }))} className="rounded-lg border border-black/15 bg-white px-2.5 py-2 text-sm text-black">
              <option value="">Todos los tipos</option>
              {Object.entries(MOV_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <select value={movFiltro.sucursalId} onChange={(e) => setMovFiltro((f) => ({ ...f, sucursalId: e.target.value }))} className="rounded-lg border border-black/15 bg-white px-2.5 py-2 text-sm text-black">
              <option value="">Todas las sucursales</option>
              {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
            <select value={movFiltro.dias} onChange={(e) => setMovFiltro((f) => ({ ...f, dias: e.target.value }))} className="rounded-lg border border-black/15 bg-white px-2.5 py-2 text-sm text-black">
              <option value="">Cualquier fecha</option>
              <option value="7">Últimos 7 días</option>
              <option value="30">Últimos 30 días</option>
              <option value="90">Últimos 90 días</option>
            </select>
            <button onClick={aplicarMovFiltro} className="rounded-full bg-[#B82D25] text-white text-sm font-medium px-4 py-2 hover:bg-[#932A1F]">Filtrar</button>
          </div>
          {cargando ? <Cargando /> : (
            <Tabla titulo={`Movimientos (${(data['movimientos'] ?? []).length})`} vacio="Sin movimientos para ese filtro."
              filas={data['movimientos'] ?? []} cols={['Fecha', 'Producto', 'Sucursal', 'Tipo', 'Cantidad']}
              render={(m: any) => {
                const salida = Number(m.cantidad) < 0;
                return (
                  <tr key={m.id} className="border-b border-black/5 last:border-0">
                    <td className="px-4 py-2.5 text-xs text-black/50 whitespace-nowrap">{new Date(m.creado_en).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
                    <td className="px-4 py-2.5"><p className="text-sm">{m.producto?.nombre}</p><p className="text-xs text-black/40">{m.producto?.sku}{m.motivo ? ` · ${m.motivo}` : ''}</p></td>
                    <td className="px-4 py-2.5 text-black/70 text-xs">{m.sucursal?.nombre}</td>
                    <td className="px-4 py-2.5 text-xs">{MOV_LABEL[m.tipo] ?? m.tipo}</td>
                    <td className={`px-4 py-2.5 text-right font-medium ${salida ? 'text-[#B82D25]' : 'text-emerald-700'}`}>{salida ? '' : '+'}{num(m.cantidad)}</td>
                  </tr>
                );
              }} />
          )}
        </div>
      )}
    </div>
  );
}

function Cargando() {
  return <p className="rounded-xl bg-white p-8 text-center text-black/40 text-sm">Cargando…</p>;
}

function Tabla({ titulo, vacio, filas, cols, render, extra }: any) {
  return (
    <section className="rounded-xl bg-white overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-black/10">
        <h2 className="font-medium text-black text-sm">{titulo}</h2>
        {extra}
      </div>
      {filas.length === 0 ? (
        <p className="px-4 py-8 text-center text-black/50 text-sm">{vacio}</p>
      ) : (
        <table className="w-full text-sm text-black">
          <thead>
            <tr className="text-left text-xs text-black/50 border-b border-black/5">
              {cols.map((c: string, i: number) => <th key={c} className={`px-4 py-2 font-medium ${i >= 2 ? 'text-right' : ''}`}>{c}</th>)}
            </tr>
          </thead>
          <tbody>{filas.map(render)}</tbody>
        </table>
      )}
    </section>
  );
}
