import Link from 'next/link';
import type { KeyboardEvent, ReactNode } from 'react';
import { FOCO_ADENTRO, unir } from './clases';

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

const CLASE_PESTANA =
  'relative -mb-px inline-flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-t-xl border-b-2 px-3 text-sm font-semibold transition-colors';

/**
 * Pestañas de sección: una fila subrayada que en el celular scrollea de
 * costado (nunca se sale del ancho ni se parte en dos renglones).
 *
 * Dos formas, según las opciones:
 * - Todas con `href`: es navegación (cada pestaña es una dirección). Se arma
 *   como <nav> con enlaces y la activa lleva aria-current. Sirve en page.tsx.
 * - Sin `href`, con `onCambiar`: pestañas de verdad (role="tablist"); con el
 *   teclado se pasa de una a otra con las flechas, Inicio y Fin.
 */
export function Pestanas<V extends string>({
  opciones,
  valor,
  onCambiar,
  etiquetaAccesible = 'Secciones',
  aLoAncho = false,
  className,
}: PropsPestanas<V>) {
  const sonEnlaces = opciones.length > 0 && opciones.every((o) => o.href);

  const clases = (activa: boolean) =>
    unir(
      CLASE_PESTANA,
      FOCO_ADENTRO,
      activa ? 'border-marca text-tinta' : 'border-transparent text-tinta/60 hover:border-black/15 hover:text-tinta',
    );

  const contenido = (o: OpcionPestana<V>, activa: boolean) => (
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

  const contenedor = unir(
    'min-w-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
    aLoAncho && '-mx-4 px-4 sm:mx-0 sm:px-0',
    className,
  );
  const fila = 'flex min-w-max gap-1 border-b border-black/10';

  if (sonEnlaces) {
    return (
      <nav aria-label={etiquetaAccesible} className={contenedor}>
        <div className={fila}>
          {opciones.map((o) => {
            const activa = o.valor === valor;
            return (
              <Link key={o.valor} href={o.href!} aria-current={activa ? 'page' : undefined} className={clases(activa)}>
                {contenido(o, activa)}
              </Link>
            );
          })}
        </div>
      </nav>
    );
  }

  // Flechas, Inicio y Fin: mueven el foco y cambian de pestaña (patrón de
  // pestañas de WAI-ARIA). Tab entra a la activa y sale de la fila.
  const alTeclear = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = opciones.findIndex((o) => o.valor === valor);
    const destino =
      e.key === 'ArrowRight' ? (i + 1) % opciones.length
      : e.key === 'ArrowLeft' ? (i - 1 + opciones.length) % opciones.length
      : e.key === 'Home' ? 0
      : e.key === 'End' ? opciones.length - 1
      : -1;
    if (destino < 0) return;
    e.preventDefault();
    onCambiar?.(opciones[destino].valor);
    e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[destino]?.focus();
  };

  // si ninguna está activa, la primera recibe el Tab (si no, no se llega)
  const hayActiva = opciones.some((o) => o.valor === valor);
  return (
    <div className={contenedor}>
      <div role="tablist" aria-label={etiquetaAccesible} className={fila} onKeyDown={alTeclear}>
        {opciones.map((o, indice) => {
          const activa = o.valor === valor;
          return (
            <button
              key={o.valor}
              type="button"
              role="tab"
              aria-selected={activa}
              tabIndex={activa || (!hayActiva && indice === 0) ? 0 : -1}
              onClick={() => onCambiar?.(o.valor)}
              className={clases(activa)}
            >
              {contenido(o, activa)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
