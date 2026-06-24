'use client';

import { useState } from 'react';

const pesos = (n: number) => '$' + Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fecha = (s: string) => new Date(s).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' });

const TIPO_LABEL: Record<string, string> = {
  FA: 'Fact. A', FB: 'Fact. B', FC: 'Fact. C',
  NCA: 'NC A', NCB: 'NC B', NCC: 'NC C', NDA: 'ND A', NDB: 'ND B', NDC: 'ND C',
};

export function LibroIvaWorkspace({ inicial }: { inicial: any }) {
  const [data, setData] = useState<any>(inicial);
  const [periodo, setPeriodo] = useState<string>(inicial?.periodo ?? new Date().toISOString().slice(0, 7));
  const [tab, setTab] = useState<'ventas' | 'compras'>('ventas');
  const [cargando, setCargando] = useState(false);

  const cambiarPeriodo = async (p: string) => {
    setPeriodo(p);
    setCargando(true);
    const r = await fetch(`/api/libro-iva?periodo=${p}`).then((x) => x.json()).catch(() => null);
    if (r) setData(r);
    setCargando(false);
  };

  const v = data?.ventas ?? { filas: [], porAlicuota: [], totales: {}, cantidad: 0 };
  const co = data?.compras ?? { filas: [], totales: {}, cantidad: 0, estimadas: 0 };
  const res = data?.resumen ?? { ivaDebito: 0, ivaCredito: 0, saldo: 0 };
  const aPagar = (res.saldo ?? 0) >= 0;

  return (
    <div className="space-y-5">
      {/* controles */}
      <div className="flex flex-wrap items-center gap-3 print:hidden">
        <label className="text-sm text-black/60">Período</label>
        <input type="month" value={periodo} onChange={(e) => cambiarPeriodo(e.target.value)}
          className="rounded-lg border border-black/15 bg-white px-3 py-1.5 text-sm" />
        {cargando && <span className="text-xs text-black/40">Cargando…</span>}
        <button onClick={() => window.print()} className="ml-auto rounded-lg bg-black text-white text-sm font-medium px-4 py-1.5 hover:bg-black/80">Imprimir</button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-xl bg-white p-4 border border-black/[0.04]">
          <p className="text-xl font-semibold text-black">{pesos(res.ivaDebito)}</p>
          <p className="text-[11px] text-black/45 mt-1">IVA débito (ventas) · {v.cantidad} comp.</p>
        </div>
        <div className="rounded-xl bg-white p-4 border border-black/[0.04]">
          <p className="text-xl font-semibold text-black">{pesos(res.ivaCredito)}</p>
          <p className="text-[11px] text-black/45 mt-1">IVA crédito (compras) · {co.cantidad} fact.</p>
        </div>
        <div className={`rounded-xl p-4 border ${aPagar ? 'bg-[#B82D25]/5 border-[#B82D25]/15' : 'bg-emerald-50 border-emerald-200'}`}>
          <p className={`text-xl font-semibold ${aPagar ? 'text-[#B82D25]' : 'text-emerald-700'}`}>{pesos(Math.abs(res.saldo))}</p>
          <p className="text-[11px] text-black/45 mt-1">{aPagar ? 'Saldo a pagar a la AFIP' : 'Saldo técnico a favor'}</p>
        </div>
      </div>

      {/* tabs */}
      <div className="flex gap-1.5 border-b border-black/10 print:hidden">
        {([['ventas', `Ventas (${v.cantidad})`], ['compras', `Compras (${co.cantidad})`]] as const).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-3.5 py-2 text-sm font-medium rounded-t-lg -mb-px border-b-2 ${tab === k ? 'border-[#B82D25] text-black' : 'border-transparent text-black/45 hover:text-black'}`}>{label}</button>
        ))}
      </div>

      {/* VENTAS */}
      {tab === 'ventas' && (
        <section className="rounded-xl bg-white overflow-hidden">
          <div className="px-4 py-2.5 border-b border-black/10 text-sm font-medium text-black">Libro IVA Ventas · {periodo}</div>
          {v.filas.length === 0 ? <p className="px-4 py-10 text-center text-black/40 text-sm">Sin comprobantes en el período.</p> : (
            <table className="w-full text-sm text-black">
              <thead>
                <tr className="border-b border-black/10 text-left text-xs text-black/50">
                  <th className="px-4 py-2 font-medium">Comprobante</th>
                  <th className="px-2 py-2 font-medium">Fecha</th>
                  <th className="px-2 py-2 font-medium">Receptor</th>
                  <th className="px-2 py-2 font-medium text-right">Neto</th>
                  <th className="px-2 py-2 font-medium text-right">IVA</th>
                  <th className="px-4 py-2 font-medium text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {v.filas.map((f: any, i: number) => (
                  <tr key={i} className="border-b border-black/5 last:border-0">
                    <td className="px-4 py-1.5"><span className="text-xs text-black/55">{TIPO_LABEL[f.tipo] ?? f.tipo}</span> <span className="font-mono text-xs">{f.comprobante}</span></td>
                    <td className="px-2 py-1.5 text-xs text-black/55">{fecha(f.fecha)}</td>
                    <td className="px-2 py-1.5 text-xs">{f.receptor}{f.docNumero ? <span className="text-black/40"> · {f.docNumero}</span> : ''}</td>
                    <td className="px-2 py-1.5 text-right">{pesos(f.neto)}</td>
                    <td className="px-2 py-1.5 text-right">{pesos(f.iva)}</td>
                    <td className="px-4 py-1.5 text-right">{pesos(f.total)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-black/15 font-semibold">
                  <td className="px-4 py-2" colSpan={3}>Totales</td>
                  <td className="px-2 py-2 text-right">{pesos(v.totales.neto)}</td>
                  <td className="px-2 py-2 text-right">{pesos(v.totales.iva)}</td>
                  <td className="px-4 py-2 text-right">{pesos(v.totales.total)}</td>
                </tr>
              </tfoot>
            </table>
          )}
          {v.porAlicuota?.length > 0 && (
            <div className="px-4 py-3 border-t border-black/10 flex flex-wrap gap-x-6 gap-y-1 text-xs text-black/60">
              {v.porAlicuota.map((a: any) => (
                <span key={a.alicuota}>IVA {a.alicuota}%: neto {pesos(a.neto)} · {pesos(a.iva)}</span>
              ))}
            </div>
          )}
        </section>
      )}

      {/* COMPRAS */}
      {tab === 'compras' && (
        <section className="rounded-xl bg-white overflow-hidden">
          <div className="px-4 py-2.5 border-b border-black/10 text-sm font-medium text-black flex items-center justify-between">
            <span>Libro IVA Compras · {periodo}</span>
            {co.estimadas > 0 && <span className="text-[11px] text-[#B82D25]">{co.estimadas} con IVA estimado</span>}
          </div>
          {co.filas.length === 0 ? <p className="px-4 py-10 text-center text-black/40 text-sm">Sin facturas de proveedor en el período.</p> : (
            <table className="w-full text-sm text-black">
              <thead>
                <tr className="border-b border-black/10 text-left text-xs text-black/50">
                  <th className="px-4 py-2 font-medium">Factura</th>
                  <th className="px-2 py-2 font-medium">Fecha</th>
                  <th className="px-2 py-2 font-medium">Proveedor</th>
                  <th className="px-2 py-2 font-medium text-right">Neto</th>
                  <th className="px-2 py-2 font-medium text-right">IVA</th>
                  <th className="px-4 py-2 font-medium text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {co.filas.map((f: any, i: number) => (
                  <tr key={i} className="border-b border-black/5 last:border-0">
                    <td className="px-4 py-1.5 font-mono text-xs">{f.comprobante}{f.estimado && <span className="ml-1 text-[#B82D25]" title="IVA estimado">*</span>}</td>
                    <td className="px-2 py-1.5 text-xs text-black/55">{fecha(f.fecha)}</td>
                    <td className="px-2 py-1.5 text-xs">{f.proveedor}{f.cuit ? <span className="text-black/40"> · {f.cuit}</span> : ''}</td>
                    <td className="px-2 py-1.5 text-right">{pesos(f.neto)}</td>
                    <td className="px-2 py-1.5 text-right">{pesos(f.iva)}</td>
                    <td className="px-4 py-1.5 text-right">{pesos(f.total)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-black/15 font-semibold">
                  <td className="px-4 py-2" colSpan={3}>Totales</td>
                  <td className="px-2 py-2 text-right">{pesos(co.totales.neto)}</td>
                  <td className="px-2 py-2 text-right">{pesos(co.totales.iva)}</td>
                  <td className="px-4 py-2 text-right">{pesos(co.totales.total)}</td>
                </tr>
              </tfoot>
            </table>
          )}
          {co.estimadas > 0 && (
            <p className="px-4 py-3 border-t border-black/10 text-[11px] text-black/45">* IVA estimado al 21% (la factura se cargó sin desglose). Cargá neto e IVA al registrar la factura para que el libro sea exacto.</p>
          )}
        </section>
      )}
    </div>
  );
}
