'use client';

import { useEffect, useId, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { unir } from './clases';
import { IconoCerrar } from './iconos';

export type AnchoModal = 'chico' | 'normal' | 'ancho';

const ANCHOS: Record<AnchoModal, string> = {
  chico: 'sm:max-w-md',
  normal: 'sm:max-w-lg',
  ancho: 'sm:max-w-3xl',
};

type PropsModal = {
  abierto: boolean;
  /** Se llama con la ✕, con Escape y al tocar afuera (salvo que esté bloqueado). */
  onCerrar: () => void;
  titulo: ReactNode;
  /** Una línea debajo del título. */
  descripcion?: ReactNode;
  /** Botones de abajo (quedan fijos aunque el contenido scrollee). En el celular se reparten el ancho. */
  pie?: ReactNode;
  ancho?: AnchoModal;
  /** true mientras se guarda: no se cierra con Escape, ✕ ni tocando afuera. */
  bloquearCierre?: boolean;
  /** false: tocar afuera no cierra (formularios largos donde un toque perdido haría perder lo cargado). */
  cerrarAlTocarAfuera?: boolean;
  /** Quita el relleno del cuerpo (para listas de borde a borde). */
  sinRelleno?: boolean;
  children?: ReactNode;
};

// Pila de modales abiertos: Escape cierra solo el de arriba (un Confirmar
// abierto sobre un Modal) y el scroll de la página queda trabado mientras haya
// alguno.
const pila: string[] = [];

const suscribirNada = () => () => {};
const enCliente = () => true;
const enServidor = () => false;

const ENFOCABLES =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Ventana del panel. En el celular es una hoja que sube desde abajo; desde
 * `sm`, una ventana centrada. Mide como mucho 90% del alto visible, la
 * cabecera y el pie quedan fijos y el medio scrollea. Cierra con la ✕ (44 px),
 * con Escape y tocando afuera; el foco queda adentro mientras está abierta y
 * vuelve al botón que la abrió al cerrarse.
 */
export function Modal({
  abierto,
  onCerrar,
  titulo,
  descripcion,
  pie,
  ancho = 'normal',
  bloquearCierre = false,
  cerrarAlTocarAfuera = true,
  sinRelleno = false,
  children,
}: PropsModal) {
  const montado = useSyncExternalStore(suscribirNada, enCliente, enServidor);
  const idBase = useId();
  const idTitulo = `${idBase}-titulo`;
  const idDescripcion = `${idBase}-descripcion`;
  const panel = useRef<HTMLDivElement>(null);
  const toqueAfuera = useRef(false);

  // las funciones cambian en cada render del padre: se leen por ref para no
  // rearmar los efectos (y no perder el foco) cada vez que se escribe algo
  const cerrar = useRef(onCerrar);
  const bloqueado = useRef(bloquearCierre);
  useEffect(() => {
    cerrar.current = onCerrar;
    bloqueado.current = bloquearCierre;
  });

  useEffect(() => {
    if (!abierto) return;
    const html = document.documentElement;
    const anterior = document.activeElement as HTMLElement | null;
    pila.push(idBase);
    html.style.overflow = 'hidden';
    html.dataset.modalAbierto = '1';

    // foco adentro (si un campo ya pidió autoFocus, se respeta)
    const el = panel.current;
    if (el && !el.contains(document.activeElement)) el.focus({ preventScroll: true });

    const alTeclear = (e: KeyboardEvent) => {
      if (pila[pila.length - 1] !== idBase || !panel.current) return;
      if (e.key === 'Escape') {
        e.stopPropagation();
        if (!bloqueado.current) cerrar.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const enfocables = Array.from(panel.current.querySelectorAll<HTMLElement>(ENFOCABLES)).filter(
        (x) => x.offsetParent !== null || x === document.activeElement,
      );
      if (enfocables.length === 0) {
        e.preventDefault();
        return;
      }
      const primero = enfocables[0];
      const ultimo = enfocables[enfocables.length - 1];
      if (e.shiftKey && (document.activeElement === primero || document.activeElement === panel.current)) {
        e.preventDefault();
        ultimo.focus();
      } else if (!e.shiftKey && document.activeElement === ultimo) {
        e.preventDefault();
        primero.focus();
      }
    };
    document.addEventListener('keydown', alTeclear);

    return () => {
      document.removeEventListener('keydown', alTeclear);
      const i = pila.lastIndexOf(idBase);
      if (i >= 0) pila.splice(i, 1);
      if (pila.length === 0) {
        html.style.overflow = '';
        delete html.dataset.modalAbierto;
      }
      if (anterior && document.contains(anterior)) anterior.focus({ preventScroll: true });
    };
  }, [abierto, idBase]);

  if (!abierto || !montado) return null;

  return createPortal(
    <div
      className={unir(
        'fixed inset-0 z-modal flex items-end justify-center bg-tinta/50 animate-aparece motion-reduce:animate-none',
        'sm:items-center sm:p-6',
      )}
      onPointerDown={(e) => {
        toqueAfuera.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (e.target !== e.currentTarget || !toqueAfuera.current) return;
        if (cerrarAlTocarAfuera && !bloquearCierre) onCerrar();
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitulo}
        aria-describedby={descripcion ? idDescripcion : undefined}
        tabIndex={-1}
        className={unir(
          'flex max-h-[90dvh] w-full flex-col overflow-hidden rounded-t-3xl bg-white shadow-flotante outline-none',
          'animate-hoja-sube motion-reduce:animate-none sm:rounded-2xl',
          ANCHOS[ancho],
        )}
      >
        {/* agarradera: en el celular dice "esto es una hoja" */}
        <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-black/15 sm:hidden" aria-hidden="true" />

        <div className="flex shrink-0 items-start gap-2 border-b border-black/[0.06] py-1.5 pl-5 pr-2 sm:py-2 sm:pl-6">
          <div className="min-w-0 flex-1 py-2">
            <h2 id={idTitulo} className="text-lg font-semibold leading-snug text-tinta">
              {titulo}
            </h2>
            {descripcion && (
              <p id={idDescripcion} className="mt-0.5 text-sm text-tinta/60">
                {descripcion}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onCerrar}
            disabled={bloquearCierre}
            aria-label="Cerrar"
            className="grid size-11 shrink-0 place-items-center rounded-full text-tinta/60 transition-colors hover:bg-tinta/5 hover:text-tinta focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-marca/15 disabled:opacity-40"
          >
            <IconoCerrar className="size-5" />
          </button>
        </div>

        <div
          className={unir(
            'min-h-0 flex-1 overflow-y-auto overscroll-contain',
            !sinRelleno && 'px-5 py-4 sm:px-6',
            !pie && 'pb-[max(1rem,env(safe-area-inset-bottom))] sm:pb-5',
          )}
        >
          {children}
        </div>

        {pie && (
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-black/[0.06] bg-white px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] max-sm:*:flex-1 sm:px-6 sm:pb-4">
            {pie}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
