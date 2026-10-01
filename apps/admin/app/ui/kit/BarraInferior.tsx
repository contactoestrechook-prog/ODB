'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { unir } from './clases';

type PropsBarraInferior = {
  /** Los botones (Cobrar, Guardar). Sin `resumen`, en el celular se reparten el ancho. */
  children: ReactNode;
  /** Algo a la izquierda: el total, "3 productos". Con resumen, conviene 1 o 2 botones. */
  resumen?: ReactNode;
  /** Para lectores de pantalla. Por defecto "Acciones". */
  etiqueta?: string;
  className?: string;
};

/**
 * Barra de acciones siempre a mano. En el celular queda fija abajo (respeta el
 * gesto de inicio del iPhone) y deja su lugar reservado al final de la
 * pantalla para no tapar nada; desde `lg` flota pegada al pie del contenido.
 *
 * Mientras está en pantalla, avisa en <html> (data-barra-inferior y la
 * variable --alto-barra-inferior): el botón "Esto está mal" se esconde y el
 * cartel de instalar la app sube por encima.
 */
export function BarraInferior({ children, resumen, etiqueta = 'Acciones', className }: PropsBarraInferior) {
  const barra = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const html = document.documentElement;
    html.dataset.barraInferior = String(Number(html.dataset.barraInferior ?? 0) + 1);
    const el = barra.current;
    const medir = () => {
      // en escritorio no tapa nada (está en el flujo): no hay nada que esquivar
      const fija = el ? getComputedStyle(el).position === 'fixed' : false;
      html.style.setProperty('--alto-barra-inferior', fija && el ? `${el.offsetHeight}px` : '0px');
    };
    medir();
    const observador = el && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(medir) : null;
    if (el && observador) observador.observe(el);
    window.addEventListener('resize', medir);
    return () => {
      observador?.disconnect();
      window.removeEventListener('resize', medir);
      const quedan = Number(html.dataset.barraInferior ?? 1) - 1;
      if (quedan > 0) html.dataset.barraInferior = String(quedan);
      else {
        delete html.dataset.barraInferior;
        html.style.removeProperty('--alto-barra-inferior');
      }
    };
  }, []);

  return (
    <>
      {/* lugar reservado: en el celular la barra es fija y taparía el final */}
      <div aria-hidden="true" className="h-[calc(4.5rem+env(safe-area-inset-bottom))] lg:hidden" />
      <div
        ref={barra}
        role="region"
        aria-label={etiqueta}
        className={unir(
          'fixed inset-x-0 bottom-0 z-barra-inferior border-t border-black/10 bg-white/95 pt-3 backdrop-blur',
          'pb-[max(0.75rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))]',
          'lg:sticky lg:inset-x-auto lg:bottom-4 lg:mt-6 lg:rounded-2xl lg:border lg:border-black/[0.06] lg:px-5 lg:pb-3 lg:shadow-flotante',
          className,
        )}
      >
        <div className="mx-auto flex w-full max-w-7xl items-center gap-3">
          {resumen && <div className="min-w-0 flex-1">{resumen}</div>}
          <div
            className={unir(
              'flex items-center gap-2',
              resumen ? 'shrink-0' : 'flex-1 *:flex-1 lg:justify-end lg:*:flex-none',
            )}
          >
            {children}
          </div>
        </div>
      </div>
    </>
  );
}
