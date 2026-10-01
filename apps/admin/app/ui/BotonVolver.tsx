'use client';

import { Boton, BotonLink } from './kit';

// Flecha de línea (en lugar del glifo "←"), del mismo trazo que los íconos del kit.
function IconoVolver() {
  return (
    <svg viewBox="0 0 24 24" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M19 12H5M11 18l-6-6 6-6" />
    </svg>
  );
}

// Botón "Volver" claro y consistente para todas las pantallas de detalle.
// Acepta un href (navega) o un onClick (volver dentro de un workspace).
export function BotonVolver({ href, onClick, label = 'Volver' }: { href?: string; onClick?: () => void; label?: string }) {
  if (href) {
    return (
      <BotonLink href={href} variante="secundario" tamano="chico" icono={<IconoVolver />}>
        {label}
      </BotonLink>
    );
  }
  return (
    <Boton variante="secundario" tamano="chico" onClick={onClick} icono={<IconoVolver />}>
      {label}
    </Boton>
  );
}
