/**
 * Une clases salteando las vacías: unir('px-4', activo && 'bg-marca', className).
 * No resuelve choques (si pasás 'px-6' a un componente que ya tiene 'px-4',
 * quedan las dos): el `className` de los componentes del kit es para ubicarlos
 * (márgenes, ancho, grilla), no para cambiarles el estilo.
 */
export function unir(...partes: Array<string | false | null | undefined | 0>): string {
  return partes.filter(Boolean).join(' ');
}

/**
 * Foco visible del kit sobre fondo claro: contorno rojo de 2 px separado 2 px
 * del borde. El rojo da 6:1 sobre blanco y 5:1 sobre crema; el anillo rojo al
 * 15 % de antes daba 1,3:1 y con el teclado no se veía dónde estaba el foco.
 * Se ve solo con teclado (focus-visible), no al tocar.
 */
export const FOCO = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marca';

/**
 * El mismo contorno pero hacia adentro, para lo que va dentro de una fila con
 * scroll (pestañas, filas de una lista): ahí el de afuera queda cortado.
 */
export const FOCO_ADENTRO = 'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-marca';

/** Rótulo en mayúsculas (cabecera de tabla, etiqueta de KPI). */
export const ROTULO = 'text-xs font-semibold uppercase tracking-[0.08em] text-tinta/60';
