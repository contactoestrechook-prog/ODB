'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const pesos = (n: any) => (n == null ? '—' : '$' + Math.round(Number(n)).toLocaleString('es-AR'));

export function ComparadorWorkspace({ comparacion, proveedores }: { comparacion: any[]; proveedores: any[] }) {
  const router = useRouter();
  const [aviso, setAviso] = useState('');

  const ahorroTotal = comparacion.reduce((s, c) => s + Number(c.ahorro || 0), 0);
  const sospechosos = comparacion.filter((c) => Number(c.spread_pct) > 80).length;

  // ranking: en cuántos productos cada proveedor es el más barato
  const masBaratoEn: Record<string, number> = {};
  for (const c of comparacion) masBaratoEn[c.prov_min] = (masBaratoEn[c.prov_min] ?? 0) + 1;

  const guardar = async (id: string) => {
    setAviso('');
    const cp = (document.getElementById(`cp-${id}`) as HTMLInputElement)?.value ?? '';
    const de = Number((document.getElementById(`de-${id}`) as HTMLInputElement)?.value || 0);
    const res = await fetch('/api/comparador', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, condicionPago: cp, descuentoEfectivo: de }) });
    const d = await res.json();
    setAviso(res.ok ? 'Condiciones actualizadas.' : d.message ?? 'Error');
    if (res.ok) router.refresh();
  };

  return (
    <div className="space-y-5">
      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          ['Productos comparables', comparacion.length],
          ['Ahorro potencial', pesos(ahorroTotal), 'text-emerald-700'],
          ['A revisar (dif. >80%)', sospechosos, sospechosos > 0 ? 'text-amber-600' : ''],
          ['Proveedores', proveedores.length],
        ].map(([l, v, c]: any) => (
          <div key={l} className="rounded-xl bg-white p-3.5 border border-black/[0.04]">
            <p className={`text-lg font-semibold leading-none ${c || 'text-black'}`}>{v}</p>
            <p className="text-[11px] text-black/45 mt-1">{l}</p>
          </div>
        ))}
      </div>

      {aviso && <p className="rounded-lg bg-white p-3 text-sm text-black/70">{aviso}</p>}

      {/* Proveedores y condiciones */}
      <section className="rounded-xl bg-white overflow-hidden">
        <h2 className="px-4 py-3 border-b border-black/10 font-medium text-black text-sm">Proveedores y condiciones de pago</h2>
        <div className="divide-y divide-black/5">
          {proveedores.map((p) => (
            <div key={p.id} className="flex flex-wrap items-end gap-3 px-4 py-3">
              <div className="flex-1 min-w-[160px]">
                <p className="font-medium text-black text-sm">{p.razon_social}</p>
                {masBaratoEn[p.razon_social] > 0 && <p className="text-[11px] text-emerald-700 mt-0.5">El más barato en {masBaratoEn[p.razon_social]} producto(s)</p>}
              </div>
              <div>
                <label className="text-[11px] text-black/45 block">Condición de pago</label>
                <input id={`cp-${p.id}`} defaultValue={p.condicion_pago ?? ''} placeholder="ej. contado / 30 días" className="w-44 rounded-lg border border-black/15 px-2.5 py-1.5 text-sm" />
              </div>
              <div>
                <label className="text-[11px] text-black/45 block">% desc. efectivo</label>
                <input id={`de-${p.id}`} type="number" step="0.5" defaultValue={p.descuento_efectivo ?? 0} className="w-24 rounded-lg border border-black/15 px-2.5 py-1.5 text-sm" />
              </div>
              <button onClick={() => guardar(p.id)} className="rounded-full bg-[#B82D25] text-white text-xs font-medium px-4 py-2 hover:bg-[#932A1F]">Guardar</button>
            </div>
          ))}
        </div>
      </section>

      {/* Productos en común */}
      <section className="rounded-xl bg-white overflow-hidden">
        <h2 className="px-4 py-3 border-b border-black/10 font-medium text-black text-sm">Productos que tenés con más de un proveedor ({comparacion.length})</h2>
        {comparacion.length === 0 ? (
          <p className="px-4 py-8 text-center text-black/40 text-sm">Todavía no hay productos en común entre proveedores. Aparecen a medida que cargás listas que pisan los mismos productos.</p>
        ) : (
          <table className="w-full text-sm text-black">
            <thead><tr className="text-left text-xs text-black/50 border-b border-black/5">
              <th className="px-4 py-2 font-medium">Producto</th>
              <th className="px-4 py-2 font-medium">Conviene comprarle a</th>
              <th className="px-4 py-2 font-medium text-right">Más caro</th>
              <th className="px-4 py-2 font-medium text-right">Diferencia</th>
              <th className="px-4 py-2 font-medium text-right">Ahorro</th>
            </tr></thead>
            <tbody>
              {comparacion.map((c) => {
                const sosp = Number(c.spread_pct) > 80;
                return (
                  <tr key={c.producto_id} className="border-b border-black/5 last:border-0">
                    <td className="px-4 py-3">
                      <p className="font-medium leading-tight">{c.nombre}</p>
                      {sosp && <span className="text-[10px] text-amber-700 bg-amber-50 rounded px-1.5 py-0.5 mt-1 inline-block">revisar · puede ser otro pack/match</span>}
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-emerald-800">{c.prov_min} · {pesos(c.costo_min)}</p>
                      <p className="text-[11px] text-black/45">
                        {c.pago_min ? c.pago_min : 'sin cond.'}
                        {Number(c.desc_min) > 0 ? ` · ${c.desc_min}% efvo (lista ${pesos(c.costo_lista_min)})` : ''}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-right text-black/55">{c.prov_max}<br /><span className="text-black/70">{pesos(c.costo_max)}</span></td>
                    <td className={`px-4 py-3 text-right font-medium ${sosp ? 'text-amber-600' : 'text-black/70'}`}>{c.spread_pct}%</td>
                    <td className="px-4 py-3 text-right font-semibold text-emerald-700">{pesos(c.ahorro)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
