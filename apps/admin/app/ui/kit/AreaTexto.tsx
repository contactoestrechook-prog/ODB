'use client';

import type { ComponentPropsWithRef } from 'react';
import { useCampo } from './Campo';
import { CAJA_CAMPO, CAMPO_DESACTIVADO, CAMPO_INVALIDO, FOCO_CAMPO } from './estilosCampo';
import { unir } from './clases';

export type PropsAreaTexto = ComponentPropsWithRef<'textarea'> & { invalido?: boolean };

/** Texto de varias líneas (notas, motivos, el reporte de "Esto está mal"). */
export function AreaTexto({ invalido, className, id, rows = 4, ...resto }: PropsAreaTexto) {
  const campo = useCampo();
  const marcado = invalido ?? campo?.invalido ?? false;
  return (
    <textarea
      rows={rows}
      {...resto}
      id={id ?? campo?.id}
      aria-invalid={marcado || undefined}
      aria-describedby={resto['aria-describedby'] ?? campo?.idDescripcion}
      required={resto.required ?? (campo?.obligatorio || undefined)}
      className={unir(
        'block min-h-24 resize-y px-3.5 py-2.5 leading-relaxed placeholder:text-tinta/40',
        CAJA_CAMPO,
        FOCO_CAMPO,
        CAMPO_INVALIDO,
        CAMPO_DESACTIVADO,
        className,
      )}
    />
  );
}
