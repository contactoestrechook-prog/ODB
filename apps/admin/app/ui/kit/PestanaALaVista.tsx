'use client';

import { useEffect, useRef } from 'react';

// Pestañas que no entran a lo ancho (el celular): lleva la activa a la vista y
// esfuma el borde del lado donde quedan más pestañas, como pista de que la
// fila se desliza. Antes, en Reparto a 375 px, la activa «Entregas en la
// calle» quedaba cortada contra el borde derecho y no se veía cuál estaba
// abierta. Va adentro del contenedor que scrollea, como un <span> oculto, así
// <Pestanas> puede seguir usándose desde una página del servidor.
const AIRE = 24; // lo que se deja ver de la pestaña siguiente

export function PestanaALaVista({ valor }: { valor: string }) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const fila = ref.current?.parentElement;
    const activa = fila?.querySelector<HTMLElement>('[aria-current="page"],[role="tab"][aria-selected="true"]');
    if (!fila || !activa) return;
    const c = fila.getBoundingClientRect();
    const a = activa.getBoundingClientRect();
    // solo de costado y sin animación: no mueve la página para arriba o abajo
    if (a.right > c.right) fila.scrollLeft += a.right - c.right + AIRE;
    else if (a.left < c.left) fila.scrollLeft -= c.left - a.left + AIRE;
  }, [valor]);

  useEffect(() => {
    const fila = ref.current?.parentElement;
    if (!fila) return;
    const marcar = () => {
      const izquierda = fila.scrollLeft > 1;
      const derecha = fila.scrollLeft + fila.clientWidth < fila.scrollWidth - 1;
      const mascara =
        izquierda || derecha
          ? `linear-gradient(to right, ${izquierda ? 'transparent, black 1.5rem' : 'black'}, ${derecha ? 'black calc(100% - 1.5rem), transparent' : 'black'})`
          : '';
      fila.style.setProperty('mask-image', mascara);
      fila.style.setProperty('-webkit-mask-image', mascara);
    };
    marcar();
    fila.addEventListener('scroll', marcar, { passive: true });
    window.addEventListener('resize', marcar);
    return () => {
      fila.removeEventListener('scroll', marcar);
      window.removeEventListener('resize', marcar);
    };
  }, []);

  return <span ref={ref} hidden />;
}
