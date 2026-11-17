'use client';

import { numero } from '../../lib/formato';
import { unir } from '../kit';
import type { Item } from './comun';

// EL RECORRIDO (17/11/2026). Cada producto del pedido es un punto, en el orden
// en que se camina el salón (la API ordena por lugar). Se llena a medida que va
// al carro: se ve de un vistazo por dónde anda el que arma y qué le falta. Los
// productos del mismo lugar van juntos y el nombre del lugar (la góndola, la
// heladera) va abajo de su tramo.

type Parada = { lugar: string | null; items: { it: Item; i: number }[] };

function paradas(items: Item[]): Parada[] {
  const r: Parada[] = [];
  items.forEach((it, i) => {
    const ult = r[r.length - 1];
    if (ult && ult.lugar === (it.ubicacion ?? null)) ult.items.push({ it, i });
    else r.push({ lugar: it.ubicacion ?? null, items: [{ it, i }] });
  });
  return r;
}

export function Recorrido({ items }: { items: Item[] }) {
  const siguiente = items.findIndex((i) => i.enCarro < i.cantidad);
  const lleno = (it: Item) => it.enCarro >= it.cantidad;
  const conLugar = items.some((i) => i.ubicacion);
  return (
    <ol className="flex items-start gap-0" aria-label="Recorrido del pedido por el salón">
      {paradas(items).map((p, k) => {
        const aca = p.items.some(({ i }) => i === siguiente);
        return (
          <li key={k} className="min-w-0" style={{ flex: `${p.items.length} 1 0%` }}>
            <div className="flex">
              {p.items.map(({ it, i }) => {
                const hecho = lleno(it);
                const parte = !hecho && it.enCarro > 0 ? Math.min(1, it.enCarro / it.cantidad) : 0;
                const falta = Math.max(0, it.cantidad - it.enCarro);
                return (
                  <span key={it.productoId} className="relative flex min-w-0 flex-1 justify-center"
                    title={`${numero(it.cantidad, 2)} × ${it.nombre}${it.ubicacion ? ` · ${it.ubicacion}` : ''}${hecho ? ' · en el carro' : ` · faltan ${numero(falta, 2)}`}`}>
                    {/* el tramo que viene del punto anterior */}
                    {i > 0 && <span aria-hidden="true" className={unir('absolute right-1/2 top-[0.5625rem] h-0.5 w-full', lleno(items[i - 1]) ? 'bg-dato-3' : 'bg-crema-hondo')} />}
                    <span aria-hidden="true" className={unir(
                      'relative flex size-5 shrink-0 items-center justify-center overflow-hidden rounded-full',
                      hecho ? 'bg-dato-3' : i === siguiente ? 'bg-white ring-2 ring-dato-3 ring-offset-2 ring-offset-white' : 'border-2 border-crema-hondo bg-white',
                    )}>
                      {/* lo que ya fue al carro de ese producto, de abajo para arriba */}
                      {parte > 0 && <span className="absolute inset-x-0 bottom-0 bg-dato-3/60" style={{ height: `${parte * 100}%` }} />}
                      {hecho && <svg viewBox="0 0 12 12" className="size-3 text-white" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2.5 6.2l2.3 2.3 4.7-5" /></svg>}
                    </span>
                    <span className="sr-only">{`${it.nombre}: ${hecho ? 'en el carro' : `faltan ${numero(falta, 2)}`}`}</span>
                  </span>
                );
              })}
            </div>
            {conLugar && (
              <p className={unir('mx-1 mt-1.5 truncate border-t pt-1 text-center text-xs leading-4',
                aca ? 'border-dato-3 font-semibold text-dato-3' : p.items.every(({ it }) => lleno(it)) ? 'border-dato-3/30 text-tinta/60' : 'border-crema-hondo text-tinta/60')}>
                {p.lugar ?? 'Sin lugar'}
              </p>
            )}
          </li>
        );
      })}
    </ol>
  );
}
