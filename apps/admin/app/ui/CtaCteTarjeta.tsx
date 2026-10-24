'use client';

import { useState } from 'react';
import { Boton, Entrada, Etiqueta, FOCO, clasesBoton, unir } from './kit';
import { fecha, pesos } from '../lib/formato';

// Una cuenta corriente, de un vistazo (Leandro, 24/10/2026: «no hay card por
// cada cuenta corriente, con detalle de compra, límites disponibles, no hay
// info, es una planilla»): cuánto debe, contra qué límite y cuánto le queda,
// qué compró última vez, cuándo pagó, y los últimos movimientos con sus
// renglones. Llamar, WhatsApp y la ficha, ahí mismo.

export type Renglon = { descripcion: string; cantidad: number };
export type PerfilCompras = {
  tickets: number; total: number; ticketPromedio: number; cadaDias: number | null; primera: string | null; ultima: string | null;
  porDia: number[]; diasFuertes: string[];
  porMes: { mes: string; tickets: number; total: number }[];
  medios: { medio: string; tickets: number }[];
  productos: { codigo: string | null; nombre: string; unidades: number; total: number; veces: number }[];
};
export type DiasDeuda = { desde: string; dias: number; diasPromedio: number; facturasAbiertas: number };
export type MovTarjeta = { fecha: string; concepto: string; debe: number; haber: number; importado: boolean; renglones: Renglon[] };
export type CuentaTarjeta = {
  id: string; nombre: string; telefono: string | null; celular: string | null; sucursal: 'st' | 'si' | null;
  saldo: number; limite: number; pctConsumido: number | null; disponible: number | null; excedido: number;
  ultimaCompra: { fecha: string; monto: number } | null; ultimoPago: { fecha: string; monto: number } | null;
  diasSinPagar: number | null; compras30: number; comprado30: number; pagado30: number; traidoDelCrack: number;
  movimientos: MovTarjeta[];
  perfil: PerfilCompras | null;
  /** desde cuándo debe (la factura abierta más vieja) y la edad promedio de la deuda */
  deuda: DiasDeuda | null;
  riesgo: 'alto' | 'medio' | 'bajo';
};

const RIESGO = {
  alto: { texto: 'Riesgo alto', tono: 'error', barra: 'bg-marca', borde: 'border-marca/30' },
  medio: { texto: 'Atención', tono: 'atencion', barra: 'bg-atencion', borde: 'border-atencion/30' },
  bajo: { texto: 'Al día', tono: 'ok', barra: 'bg-ok', borde: 'border-black/10' },
} as const;
const SUCURSAL = { st: 'Sant Thomas', si: 'Santa Inés' } as const;
// de domingo a sábado, como los devuelve el perfil
const DIAS_CORTOS = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];
const DIAS_LARGOS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

const haceDias = (n: number | null) => (n == null ? '' : n === 0 ? 'hoy' : n === 1 ? 'ayer' : `hace ${n} días`);
const dias = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / 86400_000);

/** «Debe desde hace 42 días · promedio 22 días», en el color de lo vieja que es. */
export function DiasDeDeuda({ d, grande = false }: { d: DiasDeuda; grande?: boolean }) {
  const tono = d.dias >= 45 ? 'bg-marca-suave text-marca-hondo' : d.dias >= 20 ? 'bg-atencion-suave text-atencion' : 'bg-ok-suave text-ok';
  return (
    <p className={unir('mt-1 inline-flex flex-wrap items-baseline gap-x-1.5 rounded-lg px-2 py-1', grande ? 'text-sm' : 'text-xs', tono)}
      title={`La factura sin pagar más vieja es del ${d.desde.split('-').reverse().join('/')}; ${d.facturasAbiertas} facturas sin cubrir`}>
      <b>Debe hace {d.dias} {d.dias === 1 ? 'día' : 'días'}</b>
      <span>· promedio {d.diasPromedio} {d.diasPromedio === 1 ? 'día' : 'días'}</span>
    </p>
  );
}

export function CtaCteTarjeta({ c, esDueno, onAbrir, onTope }: {
  c: CuentaTarjeta;
  esDueno: boolean;
  onAbrir: () => void;
  /** guarda el límite nuevo; devuelve si salió */
  onTope: (monto: number) => Promise<boolean>;
}) {
  const r = RIESGO[c.riesgo];
  const [editando, setEditando] = useState(false);
  const [tope, setTope] = useState('');
  const [guardando, setGuardando] = useState(false);
  const usado = Math.min(c.pctConsumido ?? 0, 100);

  const guardar = async () => {
    if (guardando) return;
    setGuardando(true);
    if (await onTope(Number(tope) || 0)) setEditando(false);
    setGuardando(false);
  };

  return (
    <article className={unir('flex flex-col rounded-2xl border bg-white shadow-tarjeta', r.borde)}>
      {/* cabecera: quién es */}
      <div className="flex items-start justify-between gap-3 px-4 pt-4">
        <div className="min-w-0">
          <button type="button" onClick={onAbrir} className={unir('rounded-sm text-left text-base font-semibold text-tinta underline-offset-2 hover:underline', FOCO)}>
            <span className="break-words">{c.nombre}</span>
          </button>
          <p className="mt-0.5 text-xs text-tinta/60">
            {[c.sucursal ? SUCURSAL[c.sucursal] : null, c.celular ? `+${c.celular}` : c.telefono ? 'celular a corregir' : 'sin celular'].filter(Boolean).join(' · ')}
          </p>
        </div>
        <Etiqueta tono={r.tono} punto>{r.texto}</Etiqueta>
      </div>

      {/* cuánto debe y cuánto le queda */}
      <div className="px-4 pt-3">
        <p className="text-xs text-tinta/60">{c.saldo >= 0 ? 'Debe' : 'A favor'}</p>
        <p className={unir('importe text-2xl font-bold', c.saldo > 0 ? 'text-tinta' : 'text-ok')}>{pesos(Math.abs(c.saldo))}</p>
        {c.deuda && <DiasDeDeuda d={c.deuda} />}

        {c.limite > 0 ? (
          <div className="mt-2">
            <div className="relative h-2.5 overflow-hidden rounded-full bg-black/[0.07]" role="img" aria-label={`Usó el ${c.pctConsumido}% del límite`}>
              <div className={unir('absolute inset-y-0 left-0 rounded-full', r.barra)} style={{ width: `${usado}%` }} />
              <div className="absolute inset-y-0 w-0.5 bg-tinta/30" style={{ left: '80%' }} />
            </div>
            <div className="mt-1 flex flex-wrap justify-between gap-x-3 text-xs">
              <span className="text-tinta/70">Límite {pesos(c.limite)} · usó {c.pctConsumido}%</span>
              {c.excedido > 0
                ? <span className="font-semibold text-marca-hondo">Pasado por {pesos(c.excedido)}</span>
                : <span className="font-semibold text-ok">Disponible {pesos(c.disponible)}</span>}
            </div>
          </div>
        ) : null}

        {editando ? (
          <form onSubmit={(e) => { e.preventDefault(); guardar(); }} className="mt-2 flex items-center gap-2">
            <Entrada autoFocus value={tope} onChange={(e) => setTope(e.target.value)} type="number" inputMode="decimal" prefijo="$" placeholder="Límite" aria-label={`Límite de ${c.nombre}`}
              onKeyDown={(e) => { if (e.key === 'Escape') setEditando(false); }} />
            <Boton type="submit" tamano="chico" disabled={guardando}>Guardar</Boton>
          </form>
        ) : esDueno ? (
          <button type="button" onClick={() => { setTope(c.limite > 0 ? String(c.limite) : ''); setEditando(true); }}
            className={unir('mt-1 rounded-sm text-xs font-medium underline underline-offset-2', c.limite > 0 ? 'text-tinta/60 hover:text-tinta' : 'text-atencion hover:text-tinta', FOCO)}>
            {c.limite > 0 ? 'Cambiar el límite' : 'Sin límite: ponerle uno'}
          </button>
        ) : c.limite <= 0 ? <p className="mt-1 text-xs text-atencion">Sin límite asignado</p> : null}
      </div>

      {/* cómo compra: últimos 6 meses (del sistema viejo y de NÚCLEO) */}
      {(() => {
        const p = c.perfil;
        const ultima = c.ultimaCompra?.fecha ?? p?.ultima ?? null;
        return (
          <div className="mx-4 mt-3 rounded-xl bg-crema-claro px-3 py-3">
            <dl className="grid grid-cols-[repeat(auto-fit,minmax(6.5rem,1fr))] gap-x-3 gap-y-2 text-xs">
              <div className="min-w-0">
                <dt className="text-tinta/60">Ticket promedio</dt>
                <dd className="importe text-sm font-semibold text-tinta">{p ? pesos(p.ticketPromedio) : '—'}</dd>
                <dd className="text-tinta/60">{p ? `${p.tickets} compras, 6 meses` : 'sin compras'}</dd>
              </div>
              <div className="min-w-0">
                <dt className="text-tinta/60">Compra</dt>
                <dd className="text-sm font-semibold text-tinta">{p?.cadaDias != null ? (p.cadaDias < 1.5 ? 'casi todos los días' : `cada ${Math.round(p.cadaDias)} días`) : '—'}</dd>
                <dd className="text-tinta/60">{ultima ? `última ${haceDias(dias(ultima))}` : 'sin compras'}</dd>
              </div>
              <div className="min-w-0">
                <dt className="text-tinta/60">Último pago</dt>
                <dd className="importe text-sm font-semibold text-tinta">{c.ultimoPago ? pesos(c.ultimoPago.monto) : '—'}</dd>
                <dd className={unir(c.diasSinPagar != null && c.diasSinPagar >= 20 ? 'text-marca-hondo' : 'text-tinta/60')}>{c.ultimoPago ? haceDias(c.diasSinPagar) : 'sin pagos'}</dd>
              </div>
            </dl>

            {p && p.tickets > 0 && (
              <>
                {/* la semana: qué días compra */}
                <div className="mt-3">
                  <p className="text-xs text-tinta/60">
                    Días fuertes: <b className="text-tinta">{p.diasFuertes.length ? p.diasFuertes.join(', ') : 'parejo toda la semana'}</b>
                  </p>
                  <div className="mt-1.5 flex h-12 items-end gap-1.5" role="img" aria-label={`Compras por día: ${DIAS_CORTOS.map((d, i) => `${d} ${p.porDia[i]}`).join(', ')}`}>
                    {p.porDia.map((n, i) => {
                      const max = Math.max(...p.porDia, 1);
                      const fuerte = p.diasFuertes.includes(DIAS_LARGOS[i]);
                      return (
                        <div key={i} className="flex flex-1 flex-col items-center gap-0.5">
                          <div className={unir('w-full rounded-t-sm', fuerte ? 'bg-marca' : 'bg-tinta/20')} style={{ height: `${Math.max((n / max) * 36, n ? 3 : 1)}px` }} title={`${DIAS_LARGOS[i]}: ${n} compras`} />
                          <span className={unir('text-xs leading-none', fuerte ? 'font-semibold text-tinta' : 'text-tinta/60')}>{DIAS_CORTOS[i]}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* lo que más compra */}
                {p.productos.length > 0 && (
                  <div className="mt-3">
                    <p className="text-xs text-tinta/60">Lo que más compra</p>
                    <ul className="mt-1 space-y-0.5">
                      {p.productos.slice(0, 3).map((x) => (
                        <li key={x.codigo ?? x.nombre} className="flex items-baseline justify-between gap-2 text-xs">
                          <span className="min-w-0 truncate text-tinta" title={x.nombre}>{x.nombre}</span>
                          <span className="shrink-0 text-tinta/60">{x.veces} {x.veces === 1 ? 'vez' : 'veces'} · {pesos(x.total)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          </div>
        );
      })()}

      {/* detalle: los últimos movimientos, con lo que compró */}
      <div className="flex-1 px-4 pt-3">
        <p className="mb-1 text-xs font-semibold uppercase tracking-[0.1em] text-tinta/60">Últimos movimientos</p>
        {c.movimientos.length ? (
          <ul className="divide-y divide-black/[0.06]">
            {c.movimientos.map((m, i) => (
              <li key={i} className="py-1.5 text-sm">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 truncate text-tinta" title={m.concepto}>
                    {m.importado ? (m.haber > 0 ? 'Ajuste traído del sistema viejo' : 'Saldo traído del sistema viejo') : m.concepto}
                  </span>
                  <span className={unir('importe shrink-0 font-semibold', m.haber > 0 ? 'text-ok' : 'text-tinta')}>
                    {m.haber > 0 ? `− ${pesos(m.haber)}` : `+ ${pesos(m.debe)}`}
                  </span>
                </div>
                <p className="text-xs text-tinta/60">
                  {fecha(m.fecha, 'corta')}
                  {m.renglones.length > 0 && <> · {m.renglones.map((x) => `${x.cantidad > 1 ? `${x.cantidad} × ` : ''}${x.descripcion}`).join(', ')}</>}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-tinta/60">Sin movimientos todavía.</p>
        )}
      </div>

      {/* acciones */}
      <div className="mt-3 flex flex-wrap gap-2 border-t border-black/[0.06] px-4 py-3">
        <Boton tamano="chico" onClick={onAbrir}>Ver y editar</Boton>
        {c.celular && (
          <>
            <a href={`tel:+${c.celular}`} className={clasesBoton({ tamano: 'chico', variante: 'secundario' })}>Llamar</a>
            <a href={`https://wa.me/${c.celular}`} target="_blank" rel="noopener noreferrer" className={clasesBoton({ tamano: 'chico', variante: 'secundario' })}>WhatsApp</a>
          </>
        )}
      </div>
    </article>
  );
}
