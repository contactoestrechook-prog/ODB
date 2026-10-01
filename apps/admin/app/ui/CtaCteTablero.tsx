'use client';

import { useCallback, useEffect, useState } from 'react';
import { Aviso, Boton, Cargando, Chips, Entrada, FOCO, Kpi, Tarjeta, unir } from './kit';
import { pesos } from '../lib/formato';

// Tablero de cuentas corrientes: la plata en la calle, contra qué tope, quién
// paga bien y quién es un riesgo. Gráficos simples en SVG propio — sin
// bibliotecas: barras que se leen de un vistazo con el umbral del 80% marcado.

type Cuenta = {
  id: string; nombre: string; telefono: string | null;
  saldo: number; limite: number; pctConsumido: number | null; disponible: number | null;
  pagos: number; pagado: number; ultimoPago: string | null; diasSinPagar: number | null;
  ultimaCompra: string | null; compras30: number;
  riesgo: 'alto' | 'medio' | 'bajo';
};

// el color de cada riesgo (barras y semáforo), con los tokens del panel
const COLOR = { alto: 'bg-marca', medio: 'bg-atencion', bajo: 'bg-ok' } as const;
const ETIQ = { alto: 'Riesgo alto', medio: 'Atención', bajo: 'Al día' } as const;

export function CtaCteTablero({ esDueno }: { esDueno: boolean }) {
  const [datos, setDatos] = useState<{ kpis: any; cuentas: Cuenta[] } | null>(null);
  const [error, setError] = useState('');
  const [editando, setEditando] = useState<string | null>(null);
  const [tope, setTope] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [filtro, setFiltro] = useState<'todos' | 'alto' | 'medio' | 'bajo'>('todos');

  const cargar = useCallback(async () => {
    try {
      const r = await fetch('/api/cta-cte');
      if (!r.ok) { setError('No pude cargar el tablero'); return; }
      setDatos(await r.json());
      setError('');
    } catch { setError('Sin conexión'); }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const guardarTope = async (clienteId: string) => {
    if (guardando) return;
    setGuardando(true);
    try {
      const r = await fetch('/api/cta-cte', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clienteId, limiteCredito: Number(tope) || 0 }),
      });
      if (r.ok) { setEditando(null); cargar(); }
    } finally { setGuardando(false); }
  };

  if (error) return <Aviso tono="error">{error}</Aviso>;
  if (!datos) return <Cargando bloque />;

  const { kpis } = datos;
  const cuentas = datos.cuentas.filter((c) => filtro === 'todos' || c.riesgo === filtro);
  const conSaldo = datos.cuentas.filter((c) => c.saldo > 0);
  const maxSaldo = Math.max(...conSaldo.map((c) => c.saldo), 1);
  const topDeudores = conSaldo.slice(0, 10);
  const mejores = [...datos.cuentas].filter((c) => c.pagos > 0).sort((a, b) => b.pagado - a.pagado).slice(0, 5);

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Kpi etiqueta="En la calle" valor={pesos(kpis.enLaCalle)} />
        <Kpi etiqueta="Con saldo" valor={kpis.clientesConSaldo} />
        <Kpi etiqueta="Habilitados" valor={kpis.clientesHabilitados} />
        <Kpi etiqueta="Riesgo alto" valor={kpis.enRiesgo} tono={kpis.enRiesgo > 0 ? 'error' : 'ok'} />
        <Kpi etiqueta="Sin tope asignado" valor={kpis.sinTope} tono={kpis.sinTope > 0 ? 'atencion' : 'neutro'} />
      </div>

      {/* GRÁFICO: la deuda, cliente por cliente, contra su tope */}
      <Tarjeta>
        <h2 className="mb-1 text-base font-semibold text-tinta">Los que más deben</h2>
        <p className="mb-3 text-xs text-tinta/60">La barra es la deuda; la marca roja, el 80% de su tope (si lo tiene).</p>
        <div className="space-y-3 sm:space-y-2">
          {topDeudores.map((c) => {
            const ancho = Math.max((c.saldo / maxSaldo) * 100, 2);
            const marca80 = c.limite > 0 ? Math.min(((c.limite * 0.8) / maxSaldo) * 100, 100) : null;
            return (
              <div key={c.id} className="grid grid-cols-[1fr_auto] items-center gap-x-2 gap-y-1 text-sm sm:grid-cols-[9rem_1fr_6rem]">
                <span className="min-w-0 break-words text-tinta/80" title={c.nombre}>{c.nombre}</span>
                <div className="relative col-span-2 h-5 overflow-hidden rounded-full bg-black/[0.06] sm:col-span-1 sm:col-start-2 sm:row-start-1">
                  <div className={unir('absolute inset-y-0 left-0 rounded-full', COLOR[c.riesgo])} style={{ width: `${ancho}%` }} />
                  {marca80 != null && <div className="absolute inset-y-0 w-0.5 bg-marca" style={{ left: `${marca80}%` }} title="80% del tope" />}
                </div>
                <span className="importe col-start-2 row-start-1 text-right font-semibold text-tinta sm:col-start-3">{pesos(c.saldo)}</span>
              </div>
            );
          })}
          {!topDeudores.length && <p className="text-sm text-tinta/60">Nadie debe nada.</p>}
        </div>
      </Tarjeta>

      {/* MEJORES PAGADORES (se llena con el uso: cada cobro aprobado suma señal) */}
      <Tarjeta>
        <h2 className="mb-2 text-base font-semibold text-tinta">Mejores pagadores</h2>
        {mejores.length ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {mejores.map((c) => (
              <div key={c.id} className="min-w-0 rounded-xl border border-ok/20 bg-ok-suave p-3">
                <p className="min-w-0 break-words text-xs font-semibold text-ok" title={c.nombre}>{c.nombre}</p>
                <p className="importe text-sm font-semibold text-ok">{pesos(c.pagado)}</p>
                <p className="text-xs text-tinta/70">{c.pagos} pago(s){c.diasSinPagar != null ? ` · último hace ${c.diasSinPagar}d` : ''}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-tinta/60">
            Todavía no hay pagos registrados por el circuito nuevo. A medida que se aprueben cobros, acá aparece quién paga bien y cada cuánto.
          </p>
        )}
      </Tarjeta>

      {/* LISTA COMPLETA con semáforo, tope editable y consumo */}
      <Tarjeta>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-tinta">Todas las cuentas</h2>
          <Chips
            etiquetaAccesible="Filtrar por riesgo"
            valor={filtro}
            onCambiar={setFiltro}
            opciones={(['todos', 'alto', 'medio', 'bajo'] as const).map((f) => ({ valor: f, etiqueta: f === 'todos' ? 'Todos' : ETIQ[f] }))}
          />
        </div>
        <div className="divide-y divide-black/[0.06]">
          {cuentas.map((c) => (
            <div key={c.id} className="grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-2 py-2.5">
              <span className={unir('size-2.5 shrink-0 rounded-full', COLOR[c.riesgo])} title={ETIQ[c.riesgo]} />
              <div className="min-w-0">
                <p className="min-w-0 break-words text-sm text-tinta">
                  {c.nombre}
                  <span className="ml-2 text-xs text-tinta/60">
                    {c.diasSinPagar != null ? `último pago hace ${c.diasSinPagar}d` : c.saldo > 0 ? 'sin pagos registrados' : ''}
                    {c.compras30 > 0 && ` · ${c.compras30} compras/30d`}
                  </span>
                </p>
                {/* barra de consumo contra el tope */}
                {c.limite > 0 ? (
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <div className="relative h-2 w-full max-w-40 overflow-hidden rounded-full bg-black/10">
                      <div className={unir('absolute inset-y-0 left-0 rounded-full', (c.pctConsumido ?? 0) >= 80 ? 'bg-marca' : 'bg-ok')} style={{ width: `${Math.min(c.pctConsumido ?? 0, 100)}%` }} />
                      <div className="absolute inset-y-0 w-0.5 bg-tinta/40" style={{ left: '80%' }} />
                    </div>
                    <span className="text-xs text-tinta/60">{c.pctConsumido}% de {pesos(c.limite)}</span>
                  </div>
                ) : (
                  <p className="mt-0.5 text-xs text-atencion">sin tope: no hay alerta de crédito para este cliente</p>
                )}
              </div>
              <div className="text-right">
                <p className="importe text-sm font-semibold text-tinta">{pesos(c.saldo)}</p>
                {esDueno && editando !== c.id && (
                  <button
                    type="button"
                    onClick={() => { setEditando(c.id); setTope(c.limite > 0 ? String(c.limite) : ''); }}
                    className={unir('relative inline-flex min-h-9 items-center rounded-sm text-xs font-medium text-marca-hondo underline underline-offset-2 before:absolute before:inset-x-0 before:-inset-y-1 hover:text-marca sm:min-h-0 sm:before:hidden', FOCO)}
                  >
                    {c.limite > 0 ? `tope ${pesos(c.limite)}` : 'asignar tope'}
                  </button>
                )}
              </div>
              {esDueno && editando === c.id && (
                <div className="col-span-3 flex items-center justify-end gap-2">
                  <div className="w-36">
                    <Entrada autoFocus value={tope} onChange={(e) => setTope(e.target.value)} type="number" inputMode="decimal" placeholder="$ tope" aria-label={`Tope de ${c.nombre}`}
                      onKeyDown={(e) => { if (e.key === 'Enter') guardarTope(c.id); if (e.key === 'Escape') setEditando(null); }}
                      className="text-right" />
                  </div>
                  <Boton tamano="chico" onClick={() => guardarTope(c.id)} disabled={guardando}>ok</Boton>
                </div>
              )}
            </div>
          ))}
        </div>
      </Tarjeta>
    </div>
  );
}
