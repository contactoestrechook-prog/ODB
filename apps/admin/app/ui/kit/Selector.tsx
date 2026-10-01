'use client';

import type { ComponentPropsWithRef } from 'react';
import { useCampo } from './Campo';
import { CAJA_CAMPO, CAMPO_DESACTIVADO, CAMPO_INVALIDO, COLOR_CAMPO, FOCO_CAMPO } from './estilosCampo';
import { unir } from './clases';
import { IconoFlechaAbajo } from './iconos';

export type OpcionSelector = { valor: string; etiqueta: string; deshabilitada?: boolean };

export type PropsSelector = ComponentPropsWithRef<'select'> & {
  /** Las opciones como lista; si no, pasá <option> como hijos. */
  opciones?: OpcionSelector[];
  /** Primera opción vacía ("Todas las sucursales", "Elegí…"), con valor "". */
  vacio?: string;
  invalido?: boolean;
};

/**
 * <select> nativo con la caja del kit y su flecha. En el celular abre la
 * rueda del sistema, que es lo más cómodo. `className` va a la caja de afuera.
 */
export function Selector({ opciones, vacio, invalido, className, id, children, ...resto }: PropsSelector) {
  const campo = useCampo();
  const marcado = invalido ?? campo?.invalido ?? false;
  return (
    <div className={unir('relative min-w-0', className)}>
      <select
        {...resto}
        id={id ?? campo?.id}
        aria-invalid={marcado || undefined}
        aria-describedby={resto['aria-describedby'] ?? campo?.idDescripcion}
        required={resto.required ?? (campo?.obligatorio || undefined)}
        className={unir(
          'block min-h-11 appearance-none truncate py-2 pl-3.5 pr-10 sm:min-h-10',
          CAJA_CAMPO,
          COLOR_CAMPO,
          FOCO_CAMPO,
          CAMPO_INVALIDO,
          CAMPO_DESACTIVADO,
        )}
      >
        {vacio !== undefined && <option value="">{vacio}</option>}
        {opciones?.map((o) => (
          <option key={o.valor} value={o.valor} disabled={o.deshabilitada}>
            {o.etiqueta}
          </option>
        ))}
        {children}
      </select>
      <IconoFlechaAbajo className="pointer-events-none absolute right-3 top-1/2 size-5 -translate-y-1/2 text-tinta/60" />
    </div>
  );
}
