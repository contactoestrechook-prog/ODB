// La solapa de la pila de avisos (ui/PilaAvisos.tsx, 26/11/2026): cómo se nombra cada aviso,
// a partir del aria-label del recuadro que dibuja.

/** «Pedido nuevo DOM-…» → «Llegó un pedido»; «Pregunta de Carla» queda igual. */
export function nombreDeAviso(etiqueta: string): string {
  if (/^Pedido nuevo\b/i.test(etiqueta)) return 'Llegó un pedido';
  return etiqueta;
}

/** Lo que dice la solapa: el primero y cuántos más hay. */
export function textoDeSolapa(etiquetas: string[]): string {
  if (!etiquetas.length) return '';
  const primero = nombreDeAviso(etiquetas[0]);
  return etiquetas.length > 1 ? `${primero} y ${etiquetas.length - 1} más` : primero;
}
