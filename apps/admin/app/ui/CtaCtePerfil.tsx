'use client';

import { unir } from './kit';
import { pesos, pesosCorto } from '../lib/formato';
import type { PerfilCompras } from './CtaCteTarjeta';

// Cómo compra un cliente, completo (ficha de la cuenta, 24/10/2026): ticket
// promedio, cada cuánto, qué días, mes a mes y qué productos. Últimos 6
// meses; la tendencia mes a mes muestra 12. Sale del sistema viejo y de las
// ventas de NÚCLEO con cliente.

const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MEDIO: Record<string, string> = { 'CTA. CTE.': 'Cuenta corriente', CONTADO: 'Efectivo', TARJETA: 'Tarjeta', 'MERCADO PAGO': 'Mercado Pago', TRANSFERENCIA: 'Transferencia', COMBINADA: 'Combinado', CHEQUE: 'Cheque', 'NÚCLEO': 'NÚCLEO' };

function Dato({ etiqueta, valor, sub }: { etiqueta: string; valor: string; sub?: string }) {
  return (
    <div className="min-w-0 rounded-xl bg-crema-claro px-3 py-2.5">
      <p className="text-xs text-tinta/60">{etiqueta}</p>
      <p className="importe text-lg font-bold text-tinta">{valor}</p>
      {sub && <p className="text-xs text-tinta/60">{sub}</p>}
    </div>
  );
}

export function CtaCtePerfil({ p }: { p: PerfilCompras | null }) {
  if (!p || p.tickets === 0) {
    return <p className="text-sm text-tinta/60">No tiene compras en los últimos 6 meses, ni en el sistema viejo ni en NÚCLEO.</p>;
  }
  const maxDia = Math.max(...p.porDia, 1);
  const maxMes = Math.max(...p.porMes.map((m) => m.total), 1);
  const maxProd = Math.max(...p.productos.map((x) => x.total), 1);
  const totalMedios = p.medios.reduce((s, m) => s + m.tickets, 0) || 1;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Dato etiqueta="Ticket promedio" valor={pesos(p.ticketPromedio)} sub="últimos 6 meses" />
        <Dato etiqueta="Compras" valor={String(p.tickets)} sub={`${pesos(p.total)} en total`} />
        <Dato etiqueta="Compra" valor={p.cadaDias == null ? '—' : p.cadaDias < 1.5 ? 'Casi a diario' : `Cada ${Math.round(p.cadaDias)} días`} sub={p.ultima ? `última el ${p.ultima.split('-').reverse().join('/')}` : undefined} />
        <Dato etiqueta="Días fuertes" valor={p.diasFuertes.length ? p.diasFuertes.map((d) => d[0].toUpperCase() + d.slice(1, 3)).join(' · ') : 'Parejo'} sub={p.diasFuertes.length ? p.diasFuertes.join(', ') : 'compra toda la semana'} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* la semana */}
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.1em] text-tinta/60">Qué días compra</p>
          <div className="space-y-1.5">
            {p.porDia.map((n, i) => {
              const fuerte = p.diasFuertes.includes(DIAS[i].toLowerCase());
              return (
                <div key={i} className="grid grid-cols-[5.5rem_1fr_2.5rem] items-center gap-2 text-xs">
                  <span className={unir(fuerte ? 'font-semibold text-tinta' : 'text-tinta/70')}>{DIAS[i]}</span>
                  <div className="h-3 overflow-hidden rounded-full bg-black/[0.06]">
                    <div className={unir('h-full rounded-full', fuerte ? 'bg-marca' : 'bg-tinta/25')} style={{ width: `${(n / maxDia) * 100}%` }} />
                  </div>
                  <span className="text-right text-tinta/70">{n}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* mes a mes */}
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.1em] text-tinta/60">Mes a mes (12 meses)</p>
          <div className="flex h-36 items-end gap-1.5" role="img" aria-label={p.porMes.map((m) => `${m.mes}: ${pesos(m.total)}`).join(', ')}>
            {p.porMes.map((m) => (
              <div key={m.mes} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1" title={`${m.tickets} compras · ${pesos(m.total)}`}>
                <span className="text-xs text-tinta/60">{pesosCorto(m.total)}</span>
                <div className="w-full rounded-t-md bg-info" style={{ height: `${Math.max((m.total / maxMes) * 96, 3)}px` }} />
                <span className="text-xs text-tinta/70">{MESES[Number(m.mes.slice(5)) - 1]}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* qué compra */}
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.1em] text-tinta/60">Lo que más compra (6 meses)</p>
        <ol className="space-y-2">
          {p.productos.map((x, i) => (
            <li key={x.codigo ?? x.nombre} className="text-sm">
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate text-tinta" title={x.nombre}><span className="mr-1.5 text-tinta/60">{i + 1}.</span>{x.nombre}</span>
                <span className="importe shrink-0 font-semibold text-tinta">{pesos(x.total)}</span>
              </div>
              <div className="mt-0.5 flex items-center gap-2">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-black/[0.06]">
                  <div className="h-full rounded-full bg-marca/70" style={{ width: `${(x.total / maxProd) * 100}%` }} />
                </div>
                <span className="shrink-0 text-xs text-tinta/60">{Number(x.unidades.toFixed(2)).toLocaleString('es-AR')} u. · {x.veces} {x.veces === 1 ? 'compra' : 'compras'}</span>
              </div>
            </li>
          ))}
        </ol>
      </div>

      {/* con qué paga */}
      {p.medios.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.1em] text-tinta/60">Cómo paga</p>
          <div className="flex flex-wrap gap-2">
            {p.medios.map((m) => (
              <span key={m.medio} className="rounded-full border border-black/10 bg-white px-3 py-1 text-xs text-tinta/80">
                {MEDIO[m.medio] ?? m.medio} · {Math.round((m.tickets / totalMedios) * 100)}%
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
