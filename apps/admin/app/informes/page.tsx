import { Header } from '../ui/Header';
import { BotonInforme } from '../ui/BotonInforme';
import { apiFetch } from '../../lib/api';

const pesos = (n: number) => '$' + Math.round(n).toLocaleString('es-AR');

const MEDIO_LABEL: Record<string, string> = {
  efectivo: 'Efectivo',
  mercadopago: 'Mercado Pago',
  tarjeta: 'Tarjeta',
  cta_cte: 'Cuenta corriente',
};

export const dynamic = 'force-dynamic';

function fechaLarga(iso: string) {
  return new Date(`${iso}T12:00:00-03:00`).toLocaleDateString('es-AR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

export default async function Informes() {
  const res = await apiFetch('/informes');
  const informes: any[] = res.ok ? await res.json() : [];

  return (
    <div className="min-h-screen bg-[#F0EBE2]">
      <Header activo="/informes" />
      <main className="max-w-5xl mx-auto p-6 space-y-6">
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm text-black/60">
            El parte se genera solo todas las mañanas a las 7:00 con la venta del día anterior.
          </p>
          <BotonInforme />
        </div>

        {informes.length === 0 && (
          <section className="rounded-xl bg-white p-8 text-center text-black/50 text-sm">
            Todavía no hay informes. Generá el primero con el botón de arriba.
          </section>
        )}

        {informes.map((inf) => {
          const d = inf.datos ?? {};
          const ab = d.abastecimiento ?? {};
          return (
            <section key={inf.fecha} className="rounded-xl bg-white overflow-hidden">
              <header className="px-5 py-3 border-b border-black/10 flex items-baseline justify-between gap-3">
                <h2 className="font-medium text-black capitalize">{fechaLarga(inf.fecha)}</h2>
                <span
                  className={`text-sm font-medium ${(d.variacionPct ?? 0) >= 0 ? 'text-green-700' : 'text-[#B82D25]'}`}
                >
                  {(d.variacionPct ?? 0) >= 0 ? '▲' : '▼'} {Math.abs(d.variacionPct ?? 0)} % vs promedio 30 días
                </span>
              </header>

              {/* relato del Analista */}
              <p className="px-5 py-4 text-sm text-black leading-relaxed border-b border-black/5 whitespace-pre-line">
                {inf.relato}
              </p>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-black/5">
                {[
                  ['Facturado', pesos(d.facturado ?? 0)],
                  ['Tickets', (d.tickets ?? 0).toLocaleString('es-AR')],
                  ['Ticket promedio', pesos(d.ticketPromedio ?? 0)],
                  ['Promedio diario (30d)', pesos(d.promedioDiario30 ?? 0)],
                ].map(([titulo, valor]) => (
                  <div key={titulo as string} className="bg-white px-5 py-3">
                    <p className="text-xs text-black/50">{titulo}</p>
                    <p className="text-lg font-semibold text-black">{valor}</p>
                  </div>
                ))}
              </div>

              <div className="grid sm:grid-cols-2 gap-px bg-black/5 border-t border-black/5">
                <div className="bg-white px-5 py-4">
                  <h3 className="text-xs font-medium text-black/50 mb-2">Top del día (facturación)</h3>
                  {(d.topProductos ?? []).map((p: any) => (
                    <div key={p.sku} className="flex justify-between text-xs text-black py-1">
                      <span className="truncate pr-3">{p.nombre}</span>
                      <span className="whitespace-nowrap font-medium">{pesos(p.facturado)}</span>
                    </div>
                  ))}
                </div>
                <div className="bg-white px-5 py-4 space-y-3">
                  <div>
                    <h3 className="text-xs font-medium text-black/50 mb-2">Abastecimiento</h3>
                    <p className="text-xs text-black">
                      {ab.quiebresInminentes ?? 0} quiebres inminentes · {ab.aReponer ?? 0} a reponer ·{' '}
                      {ab.sinRotacion ?? 0} sin rotación ({pesos(ab.capitalInmovilizado ?? 0)} parados)
                    </p>
                  </div>
                  {(d.porVencer ?? []).length > 0 && (
                    <div>
                      <h3 className="text-xs font-medium text-black/50 mb-2">Por vencer (≤15 días)</h3>
                      {(d.porVencer ?? []).slice(0, 5).map((l: any, i: number) => (
                        <p key={`${l.sku}-${i}`} className="text-xs text-black py-0.5">
                          {l.nombre} — {l.cantidad} u. vence en {l.dias} días
                        </p>
                      ))}
                    </div>
                  )}
                  <div>
                    <h3 className="text-xs font-medium text-black/50 mb-1">Medios de pago</h3>
                    <p className="text-xs text-black">
                      {(d.porMedio ?? [])
                        .map((m: any) => `${MEDIO_LABEL[m.medio] ?? m.medio} ${pesos(m.total)}`)
                        .join(' · ')}
                    </p>
                  </div>
                </div>
              </div>
            </section>
          );
        })}
      </main>
    </div>
  );
}
