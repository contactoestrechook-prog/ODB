import type { ComponentPropsWithRef, ReactNode } from 'react';
import { unir } from './clases';

type PropsTarjeta = ComponentPropsWithRef<'section'> & {
  /** true (por defecto): relleno p-4 sm:p-5. false: sin relleno, para tarjetas con
   *  <TarjetaCabecera> + <TarjetaCuerpo>, listas o tablas que van de borde a borde. */
  relleno?: boolean;
};

/** La caja blanca del panel: rounded-2xl, borde divisor y sombra de tarjeta. */
export function Tarjeta({ relleno = true, className, children, ...resto }: PropsTarjeta) {
  return (
    <section
      className={unir(
        'min-w-0 rounded-2xl border border-black/[0.06] bg-white shadow-tarjeta',
        relleno && 'p-4 sm:p-5',
        className,
      )}
      {...resto}
    >
      {children}
    </section>
  );
}

type PropsCabecera = {
  titulo: ReactNode;
  /** Una línea de contexto debajo del título. */
  sub?: ReactNode;
  /** Botones o enlaces a la derecha (en el celular bajan si no entran). */
  accion?: ReactNode;
  /** Nivel del título: h2 (por defecto) o h3 si la tarjeta está dentro de otra sección. */
  nivel?: 2 | 3;
  className?: string;
};

/** Cabecera de tarjeta: título a la izquierda, acción a la derecha y una línea abajo. */
export function TarjetaCabecera({ titulo, sub, accion, nivel = 2, className }: PropsCabecera) {
  const Titulo = nivel === 3 ? 'h3' : 'h2';
  return (
    <div
      className={unir(
        'flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-black/[0.06] px-4 py-3 sm:px-5',
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        <Titulo className="text-base font-semibold leading-snug text-tinta">{titulo}</Titulo>
        {sub && <p className="mt-0.5 text-sm text-tinta/60">{sub}</p>}
      </div>
      {accion && <div className="flex flex-wrap items-center gap-2">{accion}</div>}
    </div>
  );
}

/** El cuerpo de una tarjeta sin relleno (va después de <TarjetaCabecera>). */
export function TarjetaCuerpo({ className, children, ...resto }: ComponentPropsWithRef<'div'>) {
  return (
    <div className={unir('p-4 sm:p-5', className)} {...resto}>
      {children}
    </div>
  );
}
