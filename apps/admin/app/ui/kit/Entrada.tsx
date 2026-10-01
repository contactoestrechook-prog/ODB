'use client';

import type { ComponentPropsWithRef, ReactNode } from 'react';
import { useCampo } from './Campo';
import { unir } from './clases';
import { CAJA_CAMPO, CLASES_ENTRADA } from './estilosCampo';

export type PropsEntrada = ComponentPropsWithRef<'input'> & {
  /** Algo fijo a la izquierda, dentro de la caja: "$", un ícono. */
  prefijo?: ReactNode;
  /** Algo fijo a la derecha: "kg", "%", "unid.". */
  sufijo?: ReactNode;
  /** Marca el campo con error sin usar <Campo error>. */
  invalido?: boolean;
};

/**
 * Campo de texto/número/fecha. Dentro de <Campo> toma solo el id, la ayuda y
 * el error. `className` va a la caja de afuera (ancho, márgenes).
 */
export function Entrada({ prefijo, sufijo, invalido, className, id, ...resto }: PropsEntrada) {
  const campo = useCampo();
  const marcado = invalido ?? campo?.invalido ?? false;
  const accesible = {
    id: id ?? campo?.id,
    'aria-invalid': marcado || undefined,
    'aria-describedby': resto['aria-describedby'] ?? campo?.idDescripcion,
    required: resto.required ?? (campo?.obligatorio || undefined),
  };

  if (!prefijo && !sufijo) {
    return <input {...resto} {...accesible} className={unir(CLASES_ENTRADA, className)} />;
  }

  // Con prefijo/sufijo la caja es un div y el input va sin borde adentro: así
  // el texto fijo puede medir lo que quiera ("$" o "unid.").
  return (
    <div
      className={unir(
        'flex min-h-11 items-center sm:min-h-10',
        CAJA_CAMPO,
        'focus-within:border-marca/60 focus-within:bg-white focus-within:ring-4 focus-within:ring-marca/15',
        marcado && 'border-marca bg-white',
        resto.disabled && 'cursor-not-allowed bg-crema text-tinta/40',
        className,
      )}
    >
      {prefijo && <span className="shrink-0 pl-3.5 text-tinta/60">{prefijo}</span>}
      <input
        {...resto}
        {...accesible}
        className="min-h-11 min-w-0 flex-1 bg-transparent px-3.5 py-2 text-base outline-none placeholder:text-tinta/40 disabled:cursor-not-allowed sm:min-h-10 sm:text-sm"
      />
      {sufijo && <span className="shrink-0 pr-3.5 text-tinta/60">{sufijo}</span>}
    </div>
  );
}
