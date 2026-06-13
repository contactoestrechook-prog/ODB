'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { EmitirComprobante } from './EmitirComprobante';

const pesos = (n: number) => '$' + Math.round(n || 0).toLocaleString('es-AR');

const TIPOS: Record<string, string> = {
  FA: 'Factura A', FB: 'Factura B', FC: 'Factura C',
  NCA: 'N. crédito A', NCB: 'N. crédito B', NCC: 'N. crédito C',
  NDA: 'N. débito A', NDB: 'N. débito B', NDC: 'N. débito C',
  REM: 'Remito', REC: 'Recibo', ANT: 'Anticipo', SIN: 'Interno',
};
const CHIP: Record<string, string> = {
  F: 'bg-black text-white', N: 'bg-[#B82D25]/10 text-[#932A1F]',
  R: 'bg-sky-100 text-sky-900', A: 'bg-amber-100 text-amber-900', S: 'bg-black/10 text-black/70',
};

const TABS = [
  ['resumen', 'Resumen', ''],
  ['facturas', 'Facturas', 'FA,FB,FC'],
  ['nc', 'Notas de crédito', 'NCA,NCB,NCC'],
  ['nd', 'Notas de débito', 'NDA,NDB,NDC'],
  ['remitos', 'Remitos', 'REM'],
  ['recibos', 'Recibos y anticipos', 'REC,ANT'],
  ['cuentas', 'Cuentas corrientes', ''],
] as const;

const numero = (c: any) => `${String(c.punto_venta).padStart(4, '0')}-${String(c.numero).padStart(8, '0')}`;

export function FacturacionWorkspace({
  resumen, cuentas, sucursales, ventaInicial,
}: {
  resumen: any; cuentas: any[]; sucursales: any[]; ventaInicial?: { id: string; total: number } | null;
}) {
  const [tab, setTab] = useState<string>(ventaInicial ? 'facturas' : 'resumen');
  const [cache, setCache] = useState<Record<string, any[]>>({});
  const [cargando, setCargando] = useState(false);

  const tabDef = TABS.find((t) => t[0] === tab)!;
  const porCobrar = cuentas.reduce((s, c) => s + Math.max(c.saldo, 0), 0);

  useEffect(() => {
    const filtro = tabDef[2];
    if (!filtro || cache[tab]) return;
    setCargando(true);
    fetch(`/api/facturacion?tipo=${filtro}&limite=150`)
      .then((r) => r.json())
      .then((d) => setCache((c) => ({ ...c, [tab]: Array.isArray(d) ? d : [] })))
      .finally(() => setCargando(false));
  }, [tab]);

  const G = resumen?.grupos ?? {};
  const grupoTotal = (k: string) => G[k]?.total ?? 0;
  const grupoCant = (k: string) => G[k]?.cantidad ?? 0;

  return (
    <div className="space-y-5">
      {/* indicadores */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex gap-8">
          <div>
            <p className="text-2xl font-semibold text-black leading-none">{pesos(resumen?.facturadoHoy)}</p>
            <p className="text-xs text-black/45 mt-1">facturado hoy</p>
          </div>
          <div>
            <p className="text-2xl font-semibold text-black leading-none">{pesos(resumen?.ivaMes)}</p>
            <p className="text-xs text-black/45 mt-1">IVA débito del mes</p>
          </div>
          <button onClick={() => setTab('cuentas')} className="text-left">
            <p className="text-2xl font-semibold text-[#B82D25] leading-none">{pesos(resumen?.porCobrar ?? porCobrar)}</p>
            <p className="text-xs text-black/45 mt-1">por cobrar · {resumen?.cuentasActivas ?? 0} ctas →</p>
          </button>
        </div>
        <EmitirComprobante sucursales={sucursales} ventaInicial={ventaInicial ?? null} />
      </div>

      {/* pestañas */}
      <div className="flex gap-1.5 flex-wrap border-b border-black/10">
        {TABS.map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`px-3.5 py-2 text-sm font-medium rounded-t-lg -mb-px border-b-2 ${
              tab === k ? 'border-[#B82D25] text-black' : 'border-transparent text-black/45 hover:text-black'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* RESUMEN */}
      {tab === 'resumen' && (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {[
            ['facturas', 'Facturas emitidas', 'F'],
            ['notasCredito', 'Notas de crédito', 'N'],
            ['notasDebito', 'Notas de débito', 'N'],
            ['remitos', 'Remitos', 'R'],
            ['recibos', 'Recibos y anticipos', 'R'],
            ['internos', 'Comprobantes internos', 'S'],
          ].map(([k, label, chip]) => (
            <button
              key={k}
              onClick={() => {
                const map: Record<string, string> = { facturas: 'facturas', notasCredito: 'nc', notasDebito: 'nd', remitos: 'remitos', recibos: 'recibos', internos: 'recibos' };
                setTab(map[k] ?? 'facturas');
              }}
              className="rounded-xl bg-white p-4 text-left hover:shadow-sm border border-black/[0.04]"
            >
              <div className="flex items-center justify-between">
                <span className={`text-[11px] font-medium rounded-full px-2 py-0.5 ${CHIP[chip]}`}>{label}</span>
                <span className="text-xs text-black/40">{grupoCant(k)}</span>
              </div>
              <p className="text-xl font-semibold text-black mt-2">{pesos(grupoTotal(k))}</p>
              <p className="text-[11px] text-black/40 mt-0.5">este mes</p>
            </button>
          ))}
        </div>
      )}

      {/* CUENTAS CORRIENTES */}
      {tab === 'cuentas' && (
        <section className="rounded-xl bg-white overflow-hidden">
          <div className="px-4 py-3 border-b border-black/10 flex items-center justify-between">
            <h2 className="font-medium text-black text-sm">Cuentas corrientes ({cuentas.length})</h2>
            <span className="text-sm font-medium text-[#B82D25]">{pesos(porCobrar)} por cobrar</span>
          </div>
          {cuentas.length === 0 && <p className="px-4 py-8 text-center text-black/40 text-sm">Sin movimientos de cuenta corriente.</p>}
          {cuentas.map((c) => (
            <Link key={c.cliente?.id} href={`/facturacion/cuentas/${c.cliente?.id}`}
              className="px-4 py-3 border-b border-black/5 last:border-0 flex items-center justify-between hover:bg-[#F0EBE2]/40">
              <div className="text-sm text-black">
                <p className="font-medium">{c.cliente?.razon_social ?? c.cliente?.nombre ?? '—'}</p>
                <p className="text-xs text-black/45">{c.cliente?.dni} {c.cliente?.telefono && `· ${c.cliente.telefono}`}</p>
              </div>
              <p className={`font-semibold ${c.saldo > 0 ? 'text-[#B82D25]' : 'text-emerald-700'}`}>
                {c.saldo > 0 ? `debe ${pesos(c.saldo)}` : c.saldo < 0 ? `a favor ${pesos(-c.saldo)}` : 'al día'}
              </p>
            </Link>
          ))}
        </section>
      )}

      {/* LISTADOS DE COMPROBANTES */}
      {tabDef[2] && (
        <section className="rounded-xl bg-white overflow-hidden">
          {cargando && <p className="px-4 py-8 text-center text-black/40 text-sm">Cargando…</p>}
          {!cargando && (cache[tab]?.length ?? 0) === 0 && (
            <p className="px-4 py-10 text-center text-black/40 text-sm">Sin comprobantes de este tipo todavía.</p>
          )}
          {!cargando && (cache[tab]?.length ?? 0) > 0 && (
            <table className="w-full text-sm text-black">
              <thead>
                <tr className="border-b border-black/10 text-left text-xs text-black/50">
                  <th className="px-4 py-3 font-medium">Comprobante</th>
                  <th className="px-4 py-3 font-medium">Receptor</th>
                  <th className="px-4 py-3 font-medium">Fecha</th>
                  <th className="px-4 py-3 font-medium text-center">CAE</th>
                  <th className="px-4 py-3 font-medium text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {(cache[tab] ?? []).map((c) => (
                  <tr key={c.id} className={`border-b border-black/5 last:border-0 hover:bg-[#F0EBE2]/40 ${c.estado === 'anulado' ? 'opacity-45' : ''}`}>
                    <td className="px-4 py-2.5">
                      <Link href={`/facturacion/${c.id}`} className="flex items-center gap-2">
                        <span className={`text-[11px] font-medium rounded-full px-2 py-0.5 ${CHIP[c.tipo[0]] ?? CHIP.S}`}>{TIPOS[c.tipo] ?? c.tipo}</span>
                        <span className="font-mono text-xs">{numero(c)}</span>
                        {c.estado === 'anulado' && <span className="text-[10px] text-[#B82D25] font-medium">ANULADO</span>}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-xs">
                      {c.cliente?.razon_social ?? c.cliente?.nombre ?? c.receptor?.nombre ?? 'Consumidor final'}
                      {c.condicion_pago === 'cta_cte' && <span className="ml-2 text-[10px] rounded-full bg-amber-100 text-amber-900 px-1.5 py-0.5">CTA CTE</span>}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-black/50">
                      {new Date(c.emitido_en).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="px-4 py-2.5 text-center text-xs">
                      {['FA', 'FB', 'FC', 'NCA', 'NCB', 'NCC', 'NDA', 'NDB', 'NDC'].includes(c.tipo)
                        ? c.cae ? <span className="text-emerald-700">✓</span> : <span className="text-amber-600">pend.</span>
                        : <span className="text-black/25">—</span>}
                    </td>
                    <td className="px-4 py-2.5 text-right font-medium whitespace-nowrap">{pesos(c.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
    </div>
  );
}
