'use client';

import Link from 'next/link';

// Botón "Volver" claro y consistente para todas las pantallas de detalle.
// Acepta un href (navega) o un onClick (volver dentro de un workspace).
export function BotonVolver({ href, onClick, label = 'Volver' }: { href?: string; onClick?: () => void; label?: string }) {
  const cls =
    'inline-flex items-center gap-1.5 rounded-full bg-white border border-black/15 text-sm font-medium text-black px-4 py-2 hover:bg-[#F0EBE2] shadow-sm';
  const contenido = (
    <>
      <span aria-hidden className="text-base leading-none">←</span>
      {label}
    </>
  );
  if (href) return <Link href={href} className={cls}>{contenido}</Link>;
  return <button type="button" onClick={onClick} className={cls}>{contenido}</button>;
}
