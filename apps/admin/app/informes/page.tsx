import { BotonInforme } from '../ui/BotonInforme';
import { apiFetch } from '../../lib/api';
import { Tarjeta, Vacio, unir } from '../ui/kit';
import { Pantalla } from '../ui/kit/Pantalla';
import { fecha, numero, pesos } from '../lib/formato';

const MEDIO_LABEL: Record<string, string> = {
  efectivo: 'Efectivo',
  mercadopago: 'Mercado Pago',
  tarjeta: 'Tarjeta',
  cta_cte: 'Cuenta corriente',
};

export const dynamic = 'force-dynamic';

export default async function Informes() {
  const res = await apiFetch('/informes');
  const informes: any[] = res.ok ? await res.json() : [];

  return (
    <Pantalla activo="/informes">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-tinta/70">
          El parte se genera solo todas las mañanas a las 7:00 con la venta del día anterior.
        </p>
        <BotonInforme />
      </div>

      {informes.length === 0 && (
        <Vacio titulo="Todavía no hay informes." texto="Generá el primero con el botón de arriba." />
      )}

      {informes.map((inf) => {
        const d = inf.datos ?? {};
        const ab = d.abastecimiento ?? {};
        return (
          <Tarjeta key={inf.fecha} relleno={false} className="overflow-hidden">
            <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-black/[0.06] px-4 py-3 sm:px-5">
              <h2 className="text-base font-semibold text-tinta first-letter:uppercase">{fecha(inf.fecha, 'dia')}</h2>
              <span
                className={unir('text-sm font-medium', (d.variacionPct ?? 0) >= 0 ? 'text-ok' : 'text-marca-hondo')}
              >
                {(d.variacionPct ?? 0) >= 0 ? '▲' : '▼'} {Math.abs(d.variacionPct ?? 0)} % vs promedio 30 días
              </span>
            </header>

            {/* relato del Analista */}
            <p className="whitespace-pre-line break-words border-b border-black/[0.06] px-4 py-4 text-sm leading-relaxed text-tinta sm:px-5">
              {inf.relato}
            </p>

            <div className="grid grid-cols-2 gap-px bg-black/[0.06] sm:grid-cols-4">
              {[
                ['Facturado', pesos(d.facturado ?? 0)],
                ['Tickets', numero(d.tickets ?? 0)],
                ['Ticket promedio', pesos(d.ticketPromedio ?? 0)],
                ['Promedio diario (30d)', pesos(d.promedioDiario30 ?? 0)],
              ].map(([titulo, valor]) => (
                <div key={titulo as string} className="min-w-0 bg-white px-4 py-3 sm:px-5">
                  <p className="text-xs text-tinta/60">{titulo}</p>
                  <p className="importe truncate text-lg font-semibold text-tinta">{valor}</p>
                </div>
              ))}
            </div>

            <div className="grid gap-px border-t border-black/[0.06] bg-black/[0.06] sm:grid-cols-2">
              <div className="min-w-0 bg-white px-4 py-4 sm:px-5">
                <h3 className="mb-2 text-xs font-semibold text-tinta/60">Top del día (facturación)</h3>
                {(d.topProductos ?? []).map((p: any) => (
                  <div key={p.sku} className="flex justify-between gap-3 py-1 text-xs text-tinta">
                    <span className="min-w-0 break-words">{p.nombre}</span>
                    <span className="importe shrink-0 font-medium">{pesos(p.facturado ?? 0)}</span>
                  </div>
                ))}
              </div>
              <div className="min-w-0 space-y-3 bg-white px-4 py-4 sm:px-5">
                <div>
                  <h3 className="mb-2 text-xs font-semibold text-tinta/60">Abastecimiento</h3>
                  <p className="text-xs text-tinta">
                    {ab.quiebresInminentes ?? 0} quiebres inminentes · {ab.aReponer ?? 0} a reponer ·{' '}
                    {ab.sinRotacion ?? 0} sin rotación ({pesos(ab.capitalInmovilizado ?? 0)} parados)
                  </p>
                </div>
                {(d.porVencer ?? []).length > 0 && (
                  <div>
                    <h3 className="mb-2 text-xs font-semibold text-tinta/60">Por vencer (≤15 días)</h3>
                    {(d.porVencer ?? []).slice(0, 5).map((l: any, i: number) => (
                      <p key={`${l.sku}-${i}`} className="break-words py-0.5 text-xs text-tinta">
                        {l.nombre} — {l.cantidad} u. vence en {l.dias} días
                      </p>
                    ))}
                  </div>
                )}
                <div>
                  <h3 className="mb-1 text-xs font-semibold text-tinta/60">Medios de pago</h3>
                  <p className="text-xs text-tinta">
                    {(d.porMedio ?? [])
                      .map((m: any) => `${MEDIO_LABEL[m.medio] ?? m.medio} ${pesos(m.total ?? 0)}`)
                      .join(' · ')}
                  </p>
                </div>
              </div>
            </div>
          </Tarjeta>
        );
      })}
    </Pantalla>
  );
}
