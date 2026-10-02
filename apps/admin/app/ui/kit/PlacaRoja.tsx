import type { ReactNode } from 'react';
import { unir } from './clases';

// "Placa roja": el paquete gráfico de pedidos y listas de precios (el mismo de
// las tarjetas que manda el bot por WhatsApp, apps/api/src/comun/cartel-pedido.ts).
// Pedido de Leandro (2/10/2026): "siempre que se detallen productos vamos a
// usar el paquete gráfico de pedidos y lista de precio". Franja roja con el
// logo y el título, un renglón blanco por producto con la cantidad en el
// círculo rojo, y el total en la píldora negra.

export type RenglonPlaca = {
  clave?: string;
  /** Va en el círculo rojo (unidades a pedir, en el pedido, en stock…). Sin cantidad no hay círculo. */
  cantidad?: number | string | null;
  nombre: ReactNode;
  /** Línea gris debajo del nombre (código, stock, "2 × $1.500"…). */
  detalle?: ReactNode;
  /** Línea roja debajo (precio en efectivo, "sin stock", una advertencia). */
  destacado?: ReactNode;
  /** A la derecha, grande (el precio o el subtotal ya formateado). */
  importe?: ReactNode;
  /** Algo chico al lado del nombre (una <Etiqueta>). */
  etiqueta?: ReactNode;
  /** Controles propios del renglón (casilla, − y +), abajo del texto. */
  acciones?: ReactNode;
};

/** La placa como la arma el API (apps/api/src/comun/detalle-productos.ts): se dibuja con <PlacaRoja {...detalle} />. */
export type DetallePlaca = {
  titulo: string;
  sub?: string;
  renglones: { clave: string; cantidad?: number | null; nombre: string; detalle?: string; destacado?: string; importe?: string }[];
  total?: { etiqueta: string; valor: string };
  pie?: string;
};

type PropsPlaca = {
  /** En mayúsculas en la franja: PRECIOS, RESUMEN, NOTA DE PEDIDO, PRODUCTOS… */
  titulo: string;
  /** Debajo del título (la cuenta de productos, el proveedor, la fecha). */
  sub?: ReactNode;
  renglones: RenglonPlaca[];
  /** La píldora negra del final. */
  total?: { etiqueta: string; valor: ReactNode };
  /** Recuadro blanco después del total (la entrega, a dónde va). */
  recuadro?: ReactNode;
  /** Texto chico centrado al pie ("En rojo: pagando en efectivo"). */
  pie?: ReactNode;
  /** Lo que va al final, fuera de la placa (botones). */
  acciones?: ReactNode;
  className?: string;
};

// Hasta 3 decimales: un fiambre de 1,235 kg tiene que decir lo mismo en el
// círculo y en "1,235 × $89.990" (con 2 decimales el círculo decía "1,24").
const formatoCantidad = (c: number | string) =>
  typeof c === 'number' ? (Number.isInteger(c) ? String(c) : c.toLocaleString('es-AR', { maximumFractionDigits: 3 })) : c;

export function PlacaRoja({ titulo, sub, renglones, total, recuadro, pie, acciones, className }: PropsPlaca) {
  return (
    <section className={unir('min-w-0 overflow-hidden rounded-2xl bg-crema shadow-tarjeta', className)}>
      <header className="flex items-center justify-between gap-3 bg-marca px-4 py-4 sm:px-6 sm:py-5">
        {/* el logo es una marca: no se lee en voz alta, el título sí */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/odb-logo-blanco.png" alt="" aria-hidden="true" className="h-10 w-auto shrink-0 sm:h-12" />
        <div className="min-w-0 text-right text-white">
          <h3 className="break-words text-lg font-extrabold uppercase leading-tight tracking-wide sm:text-xl">{titulo}</h3>
          {sub && <p className="mt-0.5 break-words text-sm text-white/80">{sub}</p>}
        </div>
      </header>

      <div className="space-y-2.5 p-3 sm:p-5">
        <ul className="space-y-2.5">
          {renglones.map((r, i) => {
            const hayCantidad = r.cantidad !== undefined && r.cantidad !== null && r.cantidad !== '';
            const c = hayCantidad ? formatoCantidad(r.cantidad as number | string) : '';
            return (
              <li key={r.clave ?? i} className="flex min-w-0 items-start gap-3 rounded-2xl border border-crema-hondo bg-white px-3 py-3 sm:px-4">
                {hayCantidad && (
                  <span
                    className={unir(
                      'grid size-11 shrink-0 place-items-center rounded-full bg-marca font-extrabold tabular-nums text-white',
                      c.length > 3 ? 'text-xs' : c.length > 2 ? 'text-sm' : 'text-lg',
                    )}
                  >
                    {c}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                    {/* basis-40: si el nombre y el importe no entran juntos, el importe baja */}
                    <p className="min-w-0 flex-1 basis-40 break-words font-semibold leading-snug text-tinta">
                      {r.nombre}
                      {r.etiqueta && <span className="ml-2 inline-flex align-middle">{r.etiqueta}</span>}
                    </p>
                    {r.importe !== undefined && r.importe !== null && r.importe !== '' && (
                      <span className="whitespace-nowrap text-lg font-extrabold tabular-nums text-tinta">{r.importe}</span>
                    )}
                  </div>
                  {r.detalle && <p className="mt-0.5 break-words text-sm text-tinta/60">{r.detalle}</p>}
                  {r.destacado && <p className="mt-0.5 break-words text-sm text-marca">{r.destacado}</p>}
                  {r.acciones && <div className="mt-2">{r.acciones}</div>}
                </div>
              </li>
            );
          })}
        </ul>

        {total && (
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 rounded-full bg-tinta px-5 py-3 text-white sm:px-6">
            <span className="font-extrabold uppercase tracking-wide">{total.etiqueta}</span>
            <span className="whitespace-nowrap text-xl font-extrabold tabular-nums">{total.valor}</span>
          </div>
        )}
        {recuadro && <div className="rounded-2xl border border-crema-hondo bg-white px-4 py-3 text-sm">{recuadro}</div>}
        {pie && <p className="px-2 pt-1 text-center text-sm text-tinta/70">{pie}</p>}
      </div>
      {acciones && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-crema-hondo bg-white px-4 py-3 sm:px-5">{acciones}</div>}
    </section>
  );
}
