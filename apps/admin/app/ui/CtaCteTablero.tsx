'use client';

import { useCallback, useEffect, useState } from 'react';

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

const pesos = (n: number | null) => (n == null ? '—' : '$' + Math.round(n).toLocaleString('es-AR'));
const COLOR = { alto: '#B82D25', medio: '#B77B00', bajo: '#1A7F4B' } as const;
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

  if (error) return <p className="rounded-xl bg-white p-4 text-sm text-[#B82D25]">{error}</p>;
  if (!datos) return <p className="text-sm text-black/40 p-4">Cargando…</p>;

  const { kpis } = datos;
  const cuentas = datos.cuentas.filter((c) => filtro === 'todos' || c.riesgo === filtro);
  const conSaldo = datos.cuentas.filter((c) => c.saldo > 0);
  const maxSaldo = Math.max(...conSaldo.map((c) => c.saldo), 1);
  const topDeudores = conSaldo.slice(0, 10);
  const mejores = [...datos.cuentas].filter((c) => c.pagos > 0).sort((a, b) => b.pagado - a.pagado).slice(0, 5);

  return (
    <div className="space-y-4">
      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          ['En la calle', pesos(kpis.enLaCalle), 'text-[#B82D25]'],
          ['Con saldo', kpis.clientesConSaldo, ''],
          ['Habilitados', kpis.clientesHabilitados, ''],
          ['Riesgo alto', kpis.enRiesgo, kpis.enRiesgo > 0 ? 'text-[#B82D25]' : 'text-emerald-700'],
          ['Sin tope asignado', kpis.sinTope, kpis.sinTope > 0 ? 'text-[#B77B00]' : ''],
        ].map(([l, v, c]: any) => (
          <div key={l} className="rounded-xl bg-white p-3">
            <p className="text-[11px] text-black/45">{l}</p>
            <p className={`text-xl font-semibold ${c}`}>{v}</p>
          </div>
        ))}
      </div>

      {/* GRÁFICO: la deuda, cliente por cliente, contra su tope */}
      <div className="rounded-2xl bg-white p-5">
        <h2 className="text-sm font-semibold text-black mb-1">Los que más deben</h2>
        <p className="text-[11px] text-black/40 mb-3">La barra es la deuda; la marca roja, el 80% de su tope (si lo tiene).</p>
        <div className="space-y-2">
          {topDeudores.map((c) => {
            const ancho = Math.max((c.saldo / maxSaldo) * 100, 2);
            const marca80 = c.limite > 0 ? Math.min(((c.limite * 0.8) / maxSaldo) * 100, 100) : null;
            return (
              <div key={c.id} className="grid grid-cols-[9rem_1fr_6rem] items-center gap-2 text-sm">
                <span className="truncate text-black/75" title={c.nombre}>{c.nombre}</span>
                <div className="relative h-5 rounded bg-black/5 overflow-hidden">
                  <div className="absolute inset-y-0 left-0 rounded" style={{ width: `${ancho}%`, background: COLOR[c.riesgo] }} />
                  {marca80 != null && <div className="absolute inset-y-0 w-0.5 bg-[#B82D25]" style={{ left: `${marca80}%` }} title="80% del tope" />}
                </div>
                <span className="text-right tabular-nums font-medium text-black">{pesos(c.saldo)}</span>
              </div>
            );
          })}
          {!topDeudores.length && <p className="text-sm text-black/40">Nadie debe nada.</p>}
        </div>
      </div>

      {/* MEJORES PAGADORES (se llena con el uso: cada cobro aprobado suma señal) */}
      <div className="rounded-2xl bg-white p-5">
        <h2 className="text-sm font-semibold text-black mb-2">Mejores pagadores</h2>
        {mejores.length ? (
          <div className="grid sm:grid-cols-5 gap-2">
            {mejores.map((c) => (
              <div key={c.id} className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                <p className="text-xs font-medium text-emerald-900 truncate" title={c.nombre}>{c.nombre}</p>
                <p className="text-sm font-semibold text-emerald-800">{pesos(c.pagado)}</p>
                <p className="text-[10px] text-emerald-700/70">{c.pagos} pago(s){c.diasSinPagar != null ? ` · último hace ${c.diasSinPagar}d` : ''}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-black/45">
            Todavía no hay pagos registrados por el circuito nuevo. A medida que se aprueben cobros, acá aparece quién paga bien y cada cuánto.
          </p>
        )}
      </div>

      {/* LISTA COMPLETA con semáforo, tope editable y consumo */}
      <div className="rounded-2xl bg-white p-5">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
          <h2 className="text-sm font-semibold text-black">Todas las cuentas</h2>
          <div className="flex gap-1.5">
            {(['todos', 'alto', 'medio', 'bajo'] as const).map((f) => (
              <button key={f} onClick={() => setFiltro(f)} className={`rounded-full px-3 py-1 text-xs font-medium ${filtro === f ? 'bg-black text-white' : 'bg-black/5 text-black/60'}`}>
                {f === 'todos' ? 'Todos' : ETIQ[f]}
              </button>
            ))}
          </div>
        </div>
        <div className="divide-y divide-black/5">
          {cuentas.map((c) => (
            <div key={c.id} className="py-2.5 grid grid-cols-[auto_1fr_auto] items-center gap-3">
              <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: COLOR[c.riesgo] }} title={ETIQ[c.riesgo]} />
              <div className="min-w-0">
                <p className="text-sm text-black truncate">
                  {c.nombre}
                  <span className="ml-2 text-xs text-black/40">
                    {c.diasSinPagar != null ? `último pago hace ${c.diasSinPagar}d` : c.saldo > 0 ? 'sin pagos registrados' : ''}
                    {c.compras30 > 0 && ` · ${c.compras30} compras/30d`}
                  </span>
                </p>
                {/* barra de consumo contra el tope */}
                {c.limite > 0 ? (
                  <div className="mt-1 flex items-center gap-2">
                    <div className="relative h-2 w-40 rounded bg-black/10 overflow-hidden">
                      <div className="absolute inset-y-0 left-0 rounded" style={{ width: `${Math.min(c.pctConsumido ?? 0, 100)}%`, background: (c.pctConsumido ?? 0) >= 80 ? '#B82D25' : '#1A7F4B' }} />
                      <div className="absolute inset-y-0 w-0.5 bg-black/40" style={{ left: '80%' }} />
                    </div>
                    <span className="text-[11px] text-black/50">{c.pctConsumido}% de {pesos(c.limite)}</span>
                  </div>
                ) : (
                  <p className="mt-0.5 text-[11px] text-[#B77B00]">sin tope: no hay alerta de crédito para este cliente</p>
                )}
              </div>
              <div className="text-right">
                <p className="text-sm font-semibold tabular-nums text-black">{pesos(c.saldo)}</p>
                {esDueno && (editando === c.id ? (
                  <span className="flex items-center gap-1 justify-end">
                    <input autoFocus value={tope} onChange={(e) => setTope(e.target.value)} type="number" placeholder="$ tope"
                      onKeyDown={(e) => { if (e.key === 'Enter') guardarTope(c.id); if (e.key === 'Escape') setEditando(null); }}
                      className="w-24 rounded border border-black/20 px-2 py-0.5 text-xs text-black text-right" />
                    <button onClick={() => guardarTope(c.id)} disabled={guardando} className="text-xs font-medium text-emerald-700">ok</button>
                  </span>
                ) : (
                  <button onClick={() => { setEditando(c.id); setTope(c.limite > 0 ? String(c.limite) : ''); }} className="text-[11px] text-[#B82D25] underline">
                    {c.limite > 0 ? `tope ${pesos(c.limite)}` : 'asignar tope'}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
