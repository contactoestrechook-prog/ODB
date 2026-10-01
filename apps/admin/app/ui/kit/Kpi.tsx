import type { ReactNode } from 'react';
import { ROTULO, unir } from './clases';

export type TonoKpi = 'neutro' | 'ok' | 'atencion' | 'error' | 'info';

// El tono pinta solo la cifra (nunca el fondo): el rojo sólido para un dato
// normal hace que el rojo deje de avisar.
const TONOS: Record<TonoKpi, string> = {
  neutro: 'text-tinta',
  ok: 'text-ok',
  atencion: 'text-atencion',
  error: 'text-marca-hondo',
  info: 'text-info',
};

type PropsKpi = {
  /** Qué se mide: "Facturado hoy". Va en mayúsculas chicas. */
  etiqueta: ReactNode;
  /** La cifra. Para plata, pasá <Monto valor={…} /> o pesos(…). */
  valor: ReactNode;
  /** Una línea de contexto: "12 tickets", "vs. ayer +8%". */
  sub?: ReactNode;
  tono?: TonoKpi;
  className?: string;
};

/**
 * Indicador: rótulo, cifra grande y una línea de contexto. En una grilla:
 * <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">…</div>. La cifra
 * se corta con "…" antes que salirse de la tarjeta.
 */
export function Kpi({ etiqueta, valor, sub, tono = 'neutro', className }: PropsKpi) {
  return (
    <div className={unir('min-w-0 rounded-2xl border border-black/[0.06] bg-white p-4 shadow-tarjeta sm:p-5', className)}>
      <p className={unir(ROTULO, 'truncate')}>{etiqueta}</p>
      <p className={unir('importe mt-1.5 truncate text-xl font-bold tracking-tight sm:text-2xl sm:font-semibold', TONOS[tono])}>{valor}</p>
      {sub && <p className="mt-1 text-xs text-tinta/60">{sub}</p>}
    </div>
  );
}
