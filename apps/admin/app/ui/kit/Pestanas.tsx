import Link from 'next/link';
import type { ReactNode } from 'react';
import { unir } from './clases';

export type OpcionPestana<V extends string = string> = {
  valor: V;
  etiqueta: ReactNode;
  /** Un número al lado (pendientes, cantidad). */
  cuenta?: number;
  /** Si la pestaña cambia la URL (?vista=…), pasá el href: se arma con <Link>. */
  href?: string;
};

type PropsPestanas<V extends string> = {
  opciones: OpcionPestana<V>[];
  /** La pestaña activa. */
  valor: V;
  /** Para pestañas con botón (sin href). */
  onCambiar?: (valor: V) => void;
  /** Qué agrupan, para lectores de pantalla ("Vistas de compras"). */
  etiquetaAccesible?: string;
  /** true: en el celular la fila llega de borde a borde de la pantalla (si está
   *  directo en <Pantalla>, que tiene px-4). No usar dentro de tarjetas. */
  aLoAncho?: boolean;
  className?: string;
};

/**
 * Pestañas de sección: una fila subrayada que en el celular scrollea de
 * costado (nunca se sale del ancho ni se parte en dos renglones).
 */
export function Pestanas<V extends string>({
  opciones,
  valor,
  onCambiar,
  etiquetaAccesible = 'Secciones',
  aLoAncho = false,
  className,
}: PropsPestanas<V>) {
  return (
    <div
      className={unir(
        'min-w-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        aLoAncho && '-mx-4 px-4 sm:mx-0 sm:px-0',
        className,
      )}
    >
      <div role="tablist" aria-label={etiquetaAccesible} className="flex min-w-max gap-1 border-b border-black/10">
        {opciones.map((o) => {
          const activa = o.valor === valor;
          const clases = unir(
            'relative -mb-px inline-flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-t-lg border-b-2 px-3 text-sm font-semibold transition-colors',
            'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-marca/15',
            activa ? 'border-marca text-tinta' : 'border-transparent text-tinta/60 hover:border-black/15 hover:text-tinta',
          );
          const contenido = (
            <>
              {o.etiqueta}
              {o.cuenta != null && (
                <span
                  className={unir(
                    'importe rounded-full px-1.5 text-xs font-semibold leading-5',
                    activa ? 'bg-marca text-white' : 'bg-crema-hondo text-tinta/70',
                  )}
                >
                  {o.cuenta}
                </span>
              )}
            </>
          );
          return o.href ? (
            <Link key={o.valor} href={o.href} role="tab" aria-selected={activa} className={clases}>
              {contenido}
            </Link>
          ) : (
            <button
              key={o.valor}
              type="button"
              role="tab"
              aria-selected={activa}
              onClick={() => onCambiar?.(o.valor)}
              className={clases}
            >
              {contenido}
            </button>
          );
        })}
      </div>
    </div>
  );
}
