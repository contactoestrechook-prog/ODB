'use client';

import { useEffect, useId, useState } from 'react';
import { Entrada, FOCO, unir } from './kit';
import { fecha } from '../lib/formato';

// Vencimiento de una factura de proveedor: en DÍAS (lo que trae casi toda
// factura: "30 días") o en FECHA. Se guarda siempre la fecha; los días se
// cuentan desde la emisión (si no hay emisión, desde hoy).
// (Leandro, 27/11/2026: «mayormente las fc vienen con plazo en días no en fecha»)

const PLAZOS_RAPIDOS = [0, 7, 15, 30, 45, 60, 90];

function hoyIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function esIso(v: string | null | undefined): v is string {
  return !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

export function sumarDias(base: string, dias: number): string {
  const [a, m, d] = base.split('-').map(Number);
  const t = new Date(Date.UTC(a, m - 1, d + dias));
  return t.toISOString().slice(0, 10);
}

export function diasEntre(desde: string, hasta: string): number {
  const ms = (s: string) => { const [a, m, d] = s.split('-').map(Number); return Date.UTC(a, m - 1, d); };
  return Math.round((ms(hasta) - ms(desde)) / 86_400_000);
}

type Props = {
  etiqueta?: string;
  /** Fecha de vencimiento (YYYY-MM-DD) o vacío. */
  valor: string;
  onCambiar: (fecha: string) => void;
  /** Fecha de emisión (YYYY-MM-DD): desde ahí se cuentan los días. */
  emision?: string | null;
  disabled?: boolean;
};

export function VencimientoPlazo({ etiqueta = 'Vencimiento', valor, onCambiar, emision, disabled }: Props) {
  const id = useId();
  const base = esIso(emision) ? emision : hoyIso();
  // Arranca en días, salvo que ya haya una fecha que no se pueda decir en días
  // (sin emisión, o anterior a la emisión: casi siempre un año mal tipeado).
  const enDias = (v: string) => !esIso(v) || (esIso(emision) && diasEntre(base, v) >= 0);
  const [modo, setModo] = useState<'dias' | 'fecha'>(() => (enDias(valor) ? 'dias' : 'fecha'));
  const [dias, setDias] = useState<string>(() => (esIso(valor) && enDias(valor) ? String(diasEntre(base, valor)) : ''));

  // Si la fecha llega de afuera (la factura terminó de cargar, la leyó la IA),
  // los días se ponen al día con ella (se ajusta en el render, no en un efecto).
  const [valorVisto, setValorVisto] = useState(valor);
  if (valor !== valorVisto) {
    setValorVisto(valor);
    if (modo === 'dias') {
      if (!esIso(valor)) { if (valor === '' && dias !== '') setDias(''); }
      else if (dias === '' || sumarDias(base, Number(dias)) !== valor) {
        if (enDias(valor)) setDias(String(diasEntre(base, valor)));
        else setModo('fecha');
      }
    }
  }

  // En modo días, si cambia la emisión, el vencimiento se corre con ella.
  useEffect(() => {
    if (modo !== 'dias' || dias === '' || isNaN(Number(dias))) return;
    const nueva = sumarDias(base, Number(dias));
    if (nueva !== valor) onCambiar(nueva);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base]);

  const cambiarDias = (v: string) => {
    const limpio = v.replace(/[^\d]/g, '').slice(0, 3);
    setDias(limpio);
    onCambiar(limpio === '' ? '' : sumarDias(base, Number(limpio)));
  };

  const cambiarModo = (m: 'dias' | 'fecha') => {
    setModo(m);
    if (m === 'dias') {
      const d = esIso(valor) ? diasEntre(base, valor) : null;
      if (d != null && d >= 0) setDias(String(d));
      else { setDias(''); onCambiar(''); }
    }
  };

  const desde = esIso(emision) ? 'la emisión' : 'hoy (falta la fecha de emisión)';
  const diasNum = esIso(valor) ? diasEntre(base, valor) : null;
  const ayuda = !esIso(valor)
    ? (modo === 'dias' ? `Los días se cuentan desde ${desde}.` : null)
    : modo === 'dias'
      ? `Vence el ${fecha(valor)} · ${dias} día${dias === '1' ? '' : 's'} desde ${desde}`
      : diasNum! < 0
        ? `Ojo: vence ${-diasNum!} días ANTES de la emisión. ¿Está bien el año?`
        : `${diasNum} día${diasNum === 1 ? '' : 's'} desde ${desde}`;
  const alerta = esIso(valor) && diasNum! < 0;

  const boton = (m: 'dias' | 'fecha', texto: string) => (
    <button type="button" disabled={disabled} aria-pressed={modo === m} onClick={() => cambiarModo(m)}
      className={unir('rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors disabled:cursor-not-allowed', FOCO,
        modo === m ? 'bg-tinta text-white' : 'text-tinta/60 hover:text-tinta')}>
      {texto}
    </button>
  );

  return (
    <div className="min-w-0">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <label htmlFor={id} className="block text-sm font-medium text-tinta">{etiqueta}</label>
        <div role="group" aria-label="Cargar el vencimiento en" className="flex shrink-0 items-center rounded-full border border-black/10 p-0.5">
          {boton('dias', 'Días')}{boton('fecha', 'Fecha')}
        </div>
      </div>
      {modo === 'dias' ? (
        <>
          <Entrada id={id} disabled={disabled} inputMode="numeric" value={dias} onChange={(e) => cambiarDias(e.target.value)}
            placeholder="30" sufijo="días" invalido={alerta} aria-describedby={`${id}-nota`} />
          {!disabled && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {PLAZOS_RAPIDOS.map((n) => (
                <button key={n} type="button" onClick={() => cambiarDias(String(n))}
                  className={unir('rounded-full border px-2 py-0.5 text-xs transition-colors', FOCO,
                    dias === String(n) ? 'border-tinta bg-tinta text-white' : 'border-black/10 text-tinta/60 hover:border-black/25 hover:text-tinta')}>
                  {n === 0 ? 'Contado' : n}
                </button>
              ))}
            </div>
          )}
        </>
      ) : (
        <Entrada id={id} disabled={disabled} type="date" value={valor} onChange={(e) => onCambiar(e.target.value)}
          invalido={alerta} aria-describedby={`${id}-nota`} />
      )}
      {ayuda && (
        <p id={`${id}-nota`} className={unir('mt-1.5', alerta ? 'text-sm font-medium text-marca-hondo' : 'text-xs text-tinta/60')}>{ayuda}</p>
      )}
    </div>
  );
}
