// Íconos de línea que usa el propio kit (24×24, trazo). Van en lugar de los
// glifos ✕ ⚠ ✓ que había sueltos en las pantallas.

type PropsIcono = { className?: string };

function Trazo({ d, className = 'size-5' }: { d: string; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={d} />
    </svg>
  );
}

export const IconoCerrar = ({ className }: PropsIcono) => <Trazo className={className} d="M6 6l12 12M18 6L6 18" />;
export const IconoFlechaAbajo = ({ className }: PropsIcono) => <Trazo className={className} d="M6 9l6 6 6-6" />;
export const IconoOk = ({ className }: PropsIcono) => <Trazo className={className} d="M12 21a9 9 0 100-18 9 9 0 000 18zM8 12.5l2.5 2.5L16 9.5" />;
export const IconoAtencion = ({ className }: PropsIcono) => <Trazo className={className} d="M12 4L2.8 19.5h18.4zM12 10v4M12 17h.01" />;
export const IconoError = ({ className }: PropsIcono) => <Trazo className={className} d="M12 21a9 9 0 100-18 9 9 0 000 18zM12 8v5M12 16h.01" />;
export const IconoInfo = ({ className }: PropsIcono) => <Trazo className={className} d="M12 21a9 9 0 100-18 9 9 0 000 18zM12 11v5M12 8h.01" />;
export const IconoVacio = ({ className }: PropsIcono) => <Trazo className={className} d="M4 13l2.5-7h11L20 13M4 13v6h16v-6M4 13h4.5l1 2h5l1-2H20" />;
