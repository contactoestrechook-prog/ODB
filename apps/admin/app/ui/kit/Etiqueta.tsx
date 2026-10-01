import type { ReactNode } from 'react';
import { unir } from './clases';

export type TonoEtiqueta = 'ok' | 'atencion' | 'error' | 'info' | 'neutro';

// Fondo suave + texto del mismo tono: todos pasan 4,5:1 de contraste.
const TONOS: Record<TonoEtiqueta, string> = {
  ok: 'bg-ok-suave text-ok',
  atencion: 'bg-atencion-suave text-atencion',
  error: 'bg-marca-suave text-marca-hondo',
  info: 'bg-info-suave text-info',
  neutro: 'bg-crema-hondo/70 text-tinta/70',
};

type PropsEtiqueta = {
  tono?: TonoEtiqueta;
  /** Un puntito del color del tono antes del texto (para estados: "En camino"). */
  punto?: boolean;
  className?: string;
  children: ReactNode;
};

/** Chip de estado (no se toca): "Cobrado", "Pendiente", "Vencido", "En camino". */
export function Etiqueta({ tono = 'neutro', punto = false, className, children }: PropsEtiqueta) {
  return (
    <span
      className={unir(
        'inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold leading-5',
        TONOS[tono],
        className,
      )}
    >
      {punto && <span className="size-1.5 shrink-0 rounded-full bg-current" aria-hidden="true" />}
      <span className="truncate">{children}</span>
    </span>
  );
}
