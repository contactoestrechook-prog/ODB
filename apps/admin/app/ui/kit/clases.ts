/**
 * Une clases salteando las vacías: unir('px-4', activo && 'bg-marca', className).
 * No resuelve choques (si pasás 'px-6' a un componente que ya tiene 'px-4',
 * quedan las dos): el `className` de los componentes del kit es para ubicarlos
 * (márgenes, ancho, grilla), no para cambiarles el estilo.
 */
export function unir(...partes: Array<string | false | null | undefined | 0>): string {
  return partes.filter(Boolean).join(' ');
}

/** Foco visible de todo el kit sobre fondo claro. */
export const FOCO = 'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-marca/15';

/** Rótulo en mayúsculas (cabecera de tabla, etiqueta de KPI). */
export const ROTULO = 'text-xs font-semibold uppercase tracking-[0.08em] text-tinta/60';
