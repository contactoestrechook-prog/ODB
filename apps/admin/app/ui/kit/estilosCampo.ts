import { unir } from './clases';

// Clases compartidas por Entrada, Selector y AreaTexto. Están en un archivo
// aparte (sin 'use client') para poder usarlas también desde el servidor, por
// ejemplo en un <input> de un formulario GET de una page.tsx.
//
// La caja de todos los campos: 44 px de alto en el celular, letra de 16 px en
// el celular (si es menor, el iPhone agranda la página) y 14 px en escritorio,
// fondo crema claro que pasa a blanco al escribir y foco rojo suave.
export const CAJA_CAMPO =
  'w-full rounded-xl border border-black/15 bg-crema-claro text-base text-tinta transition-[border-color,box-shadow,background-color] ' +
  'sm:text-sm';

export const FOCO_CAMPO = 'focus:border-marca/60 focus:bg-white focus:outline-none focus:ring-4 focus:ring-marca/15';

export const CAMPO_INVALIDO = 'aria-invalid:border-marca aria-invalid:bg-white';

export const CAMPO_DESACTIVADO = 'disabled:cursor-not-allowed disabled:bg-crema disabled:text-tinta/40';

/** Todas las clases de un <input> del kit, para usar en un <input> suelto. */
export const CLASES_ENTRADA = unir(
  'block min-h-11 px-3.5 py-2 placeholder:text-tinta/40 sm:min-h-10',
  CAJA_CAMPO,
  FOCO_CAMPO,
  CAMPO_INVALIDO,
  CAMPO_DESACTIVADO,
);
