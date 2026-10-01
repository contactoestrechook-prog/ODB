import Link from 'next/link';
import type { ComponentPropsWithRef, ReactNode } from 'react';
import { Girador } from './Cargando';
import { unir } from './clases';

/**
 * - primario: rojo marca, la acción principal de la pantalla (una sola por zona).
 * - secundario: blanco con borde (Cancelar, Volver, Exportar).
 * - fantasma: sin fondo, para acciones de poco peso dentro de listas.
 * - peligro: borde y texto rojos (Anular, Borrar, Rechazar). No es sólido para
 *   no confundirse con el primario.
 * - ok: verde, SOLO para aprobar o acreditar plata (Aprobar, Acreditar, Cobrar
 *   una cobranza a firmar).
 * El negro ya no es botón.
 */
export type VarianteBoton = 'primario' | 'secundario' | 'fantasma' | 'peligro' | 'ok';
export type TamanoBoton = 'chico' | 'normal';

const BASE =
  'relative inline-flex max-w-full items-center justify-center gap-2 rounded-full text-center font-semibold leading-tight ' +
  'select-none transition-[background-color,border-color,color,box-shadow,transform,filter] duration-150 ' +
  'active:scale-[0.98] focus-visible:outline-none focus-visible:ring-4 ' +
  'disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50';

const VARIANTES: Record<VarianteBoton, string> = {
  primario: 'bg-marca text-white hover:bg-marca-hondo focus-visible:ring-marca/25',
  secundario: 'border border-black/15 bg-white text-tinta hover:border-black/25 hover:bg-crema-claro focus-visible:ring-marca/15',
  fantasma: 'text-tinta/70 hover:bg-tinta/5 hover:text-tinta focus-visible:ring-marca/15',
  peligro: 'border border-marca/30 bg-white text-marca-hondo hover:border-marca/50 hover:bg-marca-suave focus-visible:ring-marca/15',
  ok: 'bg-ok text-white hover:brightness-90 focus-visible:ring-ok/25',
};

// 44 px de alto en el celular (dedo); en escritorio, un poco más bajos. El
// chico mide 36 px pero su zona táctil se estira a 44 con un ::before.
const TAMANOS: Record<TamanoBoton, string> = {
  normal: 'min-h-11 px-5 py-2 text-sm sm:min-h-10',
  chico: 'min-h-9 px-3.5 py-1.5 text-sm before:absolute before:inset-x-0 before:-inset-y-1 sm:min-h-8 sm:before:hidden',
};

export type OpcionesBoton = {
  variante?: VarianteBoton;
  tamano?: TamanoBoton;
  /** Ocupa todo el ancho disponible. */
  anchoCompleto?: boolean;
  className?: string;
};

/** Las clases de un botón, para casos que no son <button> ni <Link> (un <a download>, un <label> de archivo). */
export function clasesBoton({ variante = 'primario', tamano = 'normal', anchoCompleto = false, className }: OpcionesBoton = {}) {
  return unir(BASE, VARIANTES[variante], TAMANOS[tamano], anchoCompleto && 'w-full', className);
}

export type PropsBoton = ComponentPropsWithRef<'button'> &
  OpcionesBoton & {
    /** Muestra la ruedita, desactiva el botón y avisa "ocupado" a los lectores de pantalla. */
    cargando?: boolean;
    /** Ícono a la izquierda del texto. */
    icono?: ReactNode;
    /** Ícono a la derecha del texto. */
    iconoDerecha?: ReactNode;
  };

/**
 * Botón del panel. Por defecto es type="button" (no manda formularios sin
 * querer): para enviar un formulario, pasá type="submit".
 */
export function Boton({
  variante = 'primario',
  tamano = 'normal',
  anchoCompleto = false,
  cargando = false,
  icono,
  iconoDerecha,
  className,
  children,
  disabled,
  type = 'button',
  ...resto
}: PropsBoton) {
  return (
    <button
      type={type}
      disabled={disabled || cargando}
      aria-busy={cargando || undefined}
      className={clasesBoton({ variante, tamano, anchoCompleto, className })}
      {...resto}
    >
      {cargando ? <Girador className="size-4 shrink-0" /> : icono}
      {children}
      {!cargando && iconoDerecha}
    </button>
  );
}

export type PropsBotonLink = ComponentPropsWithRef<typeof Link> &
  OpcionesBoton & {
    icono?: ReactNode;
    iconoDerecha?: ReactNode;
  };

/** Un enlace (<Link> de Next) con forma de botón: "Nueva orden", "Ver detalle". */
export function BotonLink({
  variante = 'primario',
  tamano = 'normal',
  anchoCompleto = false,
  icono,
  iconoDerecha,
  className,
  children,
  ...resto
}: PropsBotonLink) {
  return (
    <Link className={clasesBoton({ variante, tamano, anchoCompleto, className })} {...resto}>
      {icono}
      {children}
      {iconoDerecha}
    </Link>
  );
}
