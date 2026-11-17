'use client';

import { numero } from '../../lib/formato';
import { unir } from '../kit';
import type { Item } from './comun';

// EL RECORRIDO (17/11/2026). Cada producto del pedido es una parada, en el orden
// en que se camina el salón (la API ordena por lugar). Se llena a medida que va
// al carro: se ve de un vistazo por dónde anda el que arma y qué le falta. Abajo,
// el nombre del lugar cada vez que cambia (la góndola, la heladera).

export function Recorrido({ items, chico = false }: { items: Item[]; chico?: boolean }) {
  const siguiente = items.findIndex((i) => i.enCarro < i.cantidad);
  return (
    <div className="min-w-0">
      <ol className="flex items-start" aria-label="Recorrido del pedido por el salón">
        {items.map((it, i) => {
          const lleno = it.enCarro >= it.cantidad;
          const parte = !lleno && it.enCarro > 0 ? Math.min(1, it.enCarro / it.cantidad) : 0;
          const esSiguiente = i === siguiente;
          const tramoHecho = i > 0 && items[i - 1].enCarro >= items[i - 1].cantidad;
          const lugar = it.ubicacion && it.ubicacion !== items[i - 1]?.ubicacion ? it.ubicacion : null;
          const falta = Math.max(0, it.cantidad - it.enCarro);
          return (
            <li key={it.productoId} className="relative flex min-w-0 flex-1 flex-col items-center" title={`${numero(it.cantidad, 2)} × ${it.nombre}${it.ubicacion ? ` · ${it.ubicacion}` : ''}${lleno ? ' · en el carro' : falta ? ` · faltan ${numero(falta, 2)}` : ''}`}>
              {/* el tramo que viene de la parada anterior */}
              {i > 0 && (
                <span aria-hidden="true" className={unir('absolute right-1/2 h-0.5 w-full', chico ? 'top-[0.4375rem]' : 'top-[0.5625rem]', tramoHecho ? 'bg-dato-3' : 'bg-crema-hondo')} />
              )}
              <span
                aria-hidden="true"
                className={unir(
                  'relative flex shrink-0 items-center justify-center overflow-hidden rounded-full',
                  chico ? 'size-4' : 'size-5',
                  lleno ? 'bg-dato-3' : esSiguiente ? 'bg-white ring-2 ring-dato-3 ring-offset-2 ring-offset-white' : 'border-2 border-crema-hondo bg-white',
                )}
              >
                {/* lo que ya fue al carro de esa parada, de abajo para arriba */}
                {parte > 0 && <span className="absolute inset-x-0 bottom-0 bg-dato-3/60" style={{ height: `${parte * 100}%` }} />}
                {lleno && !chico && (
                  <svg viewBox="0 0 12 12" className="size-3 text-white" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2.5 6.2l2.3 2.3 4.7-5" /></svg>
                )}
              </span>
              {!chico && (
                <span className={unir('mt-1.5 block h-4 max-w-full truncate px-0.5 text-xs leading-4', esSiguiente ? 'font-semibold text-dato-3' : 'text-tinta/60')}>
                  {lugar ?? ''}
                </span>
              )}
              <span className="sr-only">{`${it.nombre}: ${lleno ? 'en el carro' : `faltan ${numero(falta, 2)}`}`}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
