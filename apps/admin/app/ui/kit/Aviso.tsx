import type { ReactNode } from 'react';
import { unir } from './clases';
import { IconoAtencion, IconoError, IconoInfo, IconoOk } from './iconos';

export type TonoAviso = 'ok' | 'atencion' | 'error' | 'info' | 'neutro';

const TONOS: Record<TonoAviso, string> = {
  ok: 'border-ok/20 bg-ok-suave text-ok',
  atencion: 'border-atencion/20 bg-atencion-suave text-atencion',
  error: 'border-marca/20 bg-marca-suave text-marca-hondo',
  info: 'border-info/20 bg-info-suave text-info',
  neutro: 'border-black/[0.06] bg-crema-claro text-tinta',
};

const ICONOS: Record<TonoAviso, (p: { className?: string }) => ReactNode> = {
  ok: IconoOk,
  atencion: IconoAtencion,
  error: IconoError,
  info: IconoInfo,
  neutro: IconoInfo,
};

type PropsAviso = {
  tono?: TonoAviso;
  titulo?: ReactNode;
  /** Un botón o enlace para resolverlo ("Reintentar", "Ver la factura"). */
  accion?: ReactNode;
  className?: string;
  children?: ReactNode;
};

/**
 * Mensaje en la pantalla: error de la API, "guardado", algo que hay que mirar.
 * Los de error se anuncian enseguida a los lectores de pantalla (role="alert").
 */
export function Aviso({ tono = 'info', titulo, accion, className, children }: PropsAviso) {
  const Icono = ICONOS[tono];
  return (
    <div
      role={tono === 'error' ? 'alert' : 'status'}
      className={unir('flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm', TONOS[tono], className)}
    >
      <Icono className="mt-px size-5 shrink-0" />
      <div className="min-w-0 flex-1">
        {titulo && <p className="font-semibold leading-snug">{titulo}</p>}
        {children && <div className={unir('leading-relaxed text-tinta/80', Boolean(titulo) && 'mt-0.5')}>{children}</div>}
        {accion && <div className="mt-2.5 flex flex-wrap gap-2">{accion}</div>}
      </div>
    </div>
  );
}
