'use client';

const pesos = (n: any) => (n == null ? '—' : '$' + Math.round(Number(n)).toLocaleString('es-AR'));
const fecha = (s: string | null) => (s ? new Date(s).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' }) : '—');
const TERMINAL: Record<string, string> = { getnet: 'Getnet (Santander)', clover: 'Clover' };

export function TarjetasWorkspace({ resumen, pagos }: { resumen: any; pagos: any[] }) {
  return (
    <div className="space-y-5">
      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          ['Cobrado con tarjeta (30 días)', pesos(resumen?.bruto), '', `${resumen?.cobros ?? 0} cobros`],
          ['Por acreditar', pesos(resumen?.porAcreditar), resumen?.porAcreditar > 0 ? 'text-[#B82D25]' : ''],
          ['Acreditado (neto)', pesos(resumen?.acreditado), 'text-emerald-700'],
          ['Comisión real', pesos(resumen?.comisionReal), 'text-[#932A1F]', resumen?.comisionPromedioPct != null ? `${resumen.comisionPromedioPct} % promedio` : 'se completa al conciliar'],
        ].map(([l, v, c, sub]: any) => (
          <div key={l} className="rounded-xl bg-white p-3.5 border border-black/[0.04]">
            <p className={`text-lg font-semibold leading-none ${c || 'text-black'}`}>{v}</p>
            <p className="text-[11px] text-black/45 mt-1">{l}{sub ? ` · ${sub}` : ''}</p>
          </div>
        ))}
      </div>

      {/* por terminal */}
      {(resumen?.porTerminal ?? []).length > 0 && (
        <div className="grid sm:grid-cols-2 gap-3">
          {resumen.porTerminal.map((t: any) => (
            <div key={t.terminal} className="rounded-xl bg-white p-4 border border-black/[0.04]">
              <div className="flex items-center justify-between">
                <p className="font-medium text-black">{TERMINAL[t.terminal] ?? t.terminal}</p>
                <p className="text-base font-semibold text-black">{pesos(t.bruto)}</p>
              </div>
              <p className="text-xs text-black/45 mt-1">
                {t.cobros} cobros · por acreditar {pesos(t.porAcreditar)} · acreditado {pesos(t.acreditado)}
                {t.comisionReal > 0 ? ` · comisión ${pesos(t.comisionReal)}` : ''}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* próximas acreditaciones */}
      {(resumen?.proximasAcreditaciones ?? []).length > 0 && (
        <div className="rounded-xl bg-white p-4">
          <p className="text-sm font-medium text-black mb-2">Próximas acreditaciones estimadas</p>
          <div className="flex flex-wrap gap-2">
            {resumen.proximasAcreditaciones.map((p: any) => (
              <span key={p.fecha} className="rounded-full bg-[#F0EBE2] px-3 py-1 text-xs text-black">
                {fecha(p.fecha)} · <span className="font-semibold">{pesos(p.bruto)}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* listado */}
      <section className="rounded-xl bg-white overflow-hidden">
        <h2 className="px-4 py-3 border-b border-black/10 font-medium text-black text-sm">
          Cobros con tarjeta (últimos 30 días · {pagos.length})
        </h2>
        {pagos.length === 0 ? (
          <p className="px-4 py-10 text-center text-black/40 text-sm">
            Todavía no hay cobros con tarjeta registrados. Cuando la caja cobre con Getnet o Clover, aparecen acá
            con su fecha estimada de acreditación.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-black min-w-[40rem]">
              <thead><tr className="text-left text-xs text-black/50 border-b border-black/5">
                <th className="px-4 py-2 font-medium">Fecha</th>
                <th className="px-4 py-2 font-medium">Terminal</th>
                <th className="px-4 py-2 font-medium">Sucursal</th>
                <th className="px-4 py-2 font-medium text-right">Bruto</th>
                <th className="px-4 py-2 font-medium text-right">Comisión</th>
                <th className="px-4 py-2 font-medium text-right">Neto</th>
                <th className="px-4 py-2 font-medium text-right">Acreditación</th>
              </tr></thead>
              <tbody>
                {pagos.map((p) => (
                  <tr key={p.id} className="border-b border-black/5 last:border-0">
                    <td className="px-4 py-2.5 text-xs text-black/55 whitespace-nowrap">{fecha(p.fecha)}</td>
                    <td className="px-4 py-2.5 text-xs whitespace-nowrap">
                      <span className={`rounded-full px-2.5 py-0.5 text-[11px] ${p.terminal === 'getnet' ? 'bg-red-100 text-red-800' : p.terminal === 'clover' ? 'bg-emerald-100 text-emerald-800' : 'bg-black/5 text-black/50'}`}>
                        {TERMINAL[p.terminal] ?? p.terminal ?? 'sin identificar'}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-black/55">{p.sucursal ?? '—'}</td>
                    <td className="px-4 py-2.5 text-right font-medium">{pesos(p.bruto)}</td>
                    <td className="px-4 py-2.5 text-right text-[#932A1F] text-xs">{p.comisionReal != null ? pesos(p.comisionReal) : '—'}</td>
                    <td className="px-4 py-2.5 text-right text-xs">{p.netoReal != null ? pesos(p.netoReal) : '—'}</td>
                    <td className="px-4 py-2.5 text-right text-xs whitespace-nowrap">
                      {p.estado === 'acreditada'
                        ? <span className="rounded-full bg-emerald-100 text-emerald-800 px-2 py-0.5 text-[11px]">acreditado {fecha(p.fechaReal)}</span>
                        : <span className="text-black/55">estimado {fecha(p.fechaEstimada)}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <p className="text-xs text-black/45 px-1">
        La comisión y el neto reales se completan al conciliar la liquidación de cada procesador (Conciliación → Acreditar,
        o automático cuando integremos Getnet y Clover por API). La fecha estimada usa el plazo típico de acreditación (2 días);
        con las liquidaciones pasa a ser la fecha exacta.
      </p>
    </div>
  );
}
