// EL PANEL SE ACTUALIZA SOLO (27/11/2026). Juan Pablo seguía sin «Cuenta corriente» al
// entregar dos días después de publicada (25/11 14:53): tenía la pestaña abierta desde antes,
// y el aviso «Hay una versión nueva» solo ofrecía «Actualizar ahora / Ahora no», se escondía
// con cualquier ventana abierta y con «Ahora no» no volvía a insistir. Leandro: «Sí, hacelo»
// a «que el panel avise y se actualice cuando publicamos una versión nueva».
//
// Cuando hay una versión nueva, el panel se recarga SOLO en un momento en que no se pierde
// nada: sin ninguna ventana abierta (una factura, un pedido, el armado), sin un aviso de
// pedido o consulta en pantalla, sin nadie escribiendo en un campo y con la pantalla quieta
// un rato (nadie tocó, escribió ni movió nada). Mientras tanto queda el aviso con
// «Actualizar ahora».
//
// La alarma de los pedidos (lib/alarma-pedido.ts, regla con candado) no queda muda: Chrome
// toma la recarga de la misma página como página ya tocada (probado el 27/11/2026 con
// Chrome 158: navigator.userActivation.hasBeenActive sigue en true después de
// location.reload()), y si nadie la había tocado nunca el sonido ya estaba bloqueado antes
// de recargar (para eso está «Activá el sonido de los pedidos»).
// Se prueba en apps/api/src/comun/actualizar-sola.spec.ts.

/** Cuánto tiene que estar quieta la pantalla para recargarla sola. */
export const QUIETO_MS = 3 * 60_000;

/** Cada cuánto se mira si ya es buen momento, una vez que hay versión nueva. */
export const MIRAR_CADA_MS = 20_000;

export type MomentoDelPanel = {
  ahora: number;
  /** la última vez que alguien tocó, escribió, hizo scroll o movió el mouse */
  ultimaActividad: number;
  /** una ventana abierta: factura, pedido, armado, cualquier modal */
  ventanaAbierta: boolean;
  /** el cursor está en un campo para escribir */
  escribiendo: boolean;
  /** avisos de pedido o consulta en pantalla (no se recarga con la alarma sonando) */
  avisosEnPantalla: number;
};

/** ¿Se puede recargar ya sin que nadie pierda nada? */
export function sePuedeActualizar(m: MomentoDelPanel): boolean {
  if (m.ventanaAbierta || m.escribiendo || m.avisosEnPantalla > 0) return false;
  return m.ahora - m.ultimaActividad >= QUIETO_MS;
}

/** ¿Ese elemento es un campo donde se está escribiendo? (un botón o una tilde no cuentan) */
export function esCampoParaEscribir(el: { tagName?: string; type?: string; isContentEditable?: boolean } | null | undefined): boolean {
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = String(el.tagName ?? '').toUpperCase();
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag !== 'INPUT') return false;
  const tipo = String(el.type ?? 'text').toLowerCase();
  return !['button', 'submit', 'reset', 'checkbox', 'radio', 'range', 'color', 'file', 'image', 'hidden'].includes(tipo);
}
