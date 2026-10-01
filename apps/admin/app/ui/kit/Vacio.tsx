import type { ReactNode } from 'react';
import { unir } from './clases';
import { IconoVacio } from './iconos';

type PropsVacio = {
  /** Qué no hay: "No hay cheques en cartera". */
  titulo: ReactNode;
  /** Por qué o qué hacer: "Los que cargues en Caja aparecen acá". */
  texto?: ReactNode;
  /** Un botón para salir del vacío ("Cargar cheque"). */
  accion?: ReactNode;
  /** Otro ícono en lugar de la bandeja vacía. */
  icono?: ReactNode;
  className?: string;
};

/** Estado vacío de una lista o pantalla: siempre dice qué hacer, nunca solo "Sin datos". */
export function Vacio({ titulo, texto, accion, icono, className }: PropsVacio) {
  return (
    <div
      className={unir(
        'flex flex-col items-center rounded-2xl border border-dashed border-black/15 bg-white/60 px-6 py-10 text-center',
        className,
      )}
    >
      <div className="grid size-12 place-items-center rounded-full bg-crema text-tinta/60" aria-hidden="true">
        {icono ?? <IconoVacio className="size-6" />}
      </div>
      <p className="mt-3 text-base font-semibold text-tinta">{titulo}</p>
      {texto && <p className="mt-1 max-w-sm text-sm text-tinta/60">{texto}</p>}
      {accion && <div className="mt-4 flex flex-wrap justify-center gap-2">{accion}</div>}
    </div>
  );
}
