import { unir } from './clases';

/** Ruedita de carga. Hereda el color del texto (currentColor). */
export function Girador({ className = 'size-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={unir('animate-spin motion-reduce:animate-none', className)} fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.25" />
      <path d="M21 12a9 9 0 00-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

type PropsCargando = {
  /** Texto al lado de la ruedita. Por defecto "Cargando…". */
  texto?: string;
  /** true: ocupa su propio bloque, centrado y con aire (para una tarjeta o una pantalla vacía). */
  bloque?: boolean;
  className?: string;
};

/** Estado de carga, anunciado a los lectores de pantalla. Reemplaza los 166 "Cargando…" sueltos. */
export function Cargando({ texto = 'Cargando…', bloque = false, className }: PropsCargando) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={unir(
        'flex items-center gap-2 text-sm text-tinta/60',
        bloque && 'justify-center px-4 py-10',
        className,
      )}
    >
      <Girador className="size-4 text-marca" />
      <span>{texto}</span>
    </div>
  );
}
