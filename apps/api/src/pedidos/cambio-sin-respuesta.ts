// UN PEDIDO NO SE CIERRA CON UN CAMBIO SIN CONTESTAR (Juan Pablo, 23/11/2026, por
// el grupo: «ejecutamos la opción de ofrecerle al cliente cambiar un producto
// porque estaba sin stock, eligió otro, lo elegimos en el desplegable, se
// modificó, pero cuando se cerró no impactó en el pedido el cambio»; Leandro,
// 24/11/2026: «Solucionar»).
//
// El caso, DOM-F0CF53FF6465: no había el Feta, quien armaba eligió el Crottin y
// se le preguntó al cliente por WhatsApp. No contestó por ahí. El pedido pasó a
// «Listo» desde la pantalla de Pedidos (no por el «Terminé» del armado, que ya
// frenaba esto desde el 20/11), salió y se entregó con el cambio sin contestar:
// la venta se registró con el Feta que no estaba y el Crottin nunca entró. Y una
// vez en «Listo», el armado ya no dejaba anotar lo que dijo el cliente.
//
// Ahora pasar a listo, salir o entregar, desde cualquier pantalla, pide antes lo
// que dijo el cliente de cada cambio abierto. La pantalla lo anota ahí mismo
// («Dijo que sí / Dijo que no») y sigue.

import type { SupabaseClient } from '@supabase/supabase-js';

export const CODIGO_CAMBIO_SIN_RESPUESTA = 'CAMBIO_SIN_RESPUESTA';

/** Los cambios que todavía esperan lo que dice el cliente. */
export const CAMBIOS_ABIERTOS = ['propuesto', 'en_cola', 'preguntado'];

/** Los pasos que cierran lo que lleva el pedido: después ya no se puede anotar el cambio. */
export const PASOS_QUE_CIERRAN = ['listo', 'en_camino', 'entregado'];

export type CambioAbierto = {
  id: string;
  tipo: 'parecido' | 'variedad';
  falta: string;
  reemplazo: string | null;
  cantidad: number | null;
  pide: number | null;
  hay: number | null;
  pedida: string | null;
  variedades: string[];
  estado: string;
};

const numeroONulo = (n: unknown) => (n == null || n === '' || !Number.isFinite(Number(n)) ? null : Number(n));

export async function cambiosAbiertos(db: SupabaseClient, pedidoId: string): Promise<CambioAbierto[]> {
  // si la consulta no sale, no frena (como antes de esta regla): el pedido no se traba por un error de lectura
  let data: unknown = null;
  try {
    const r = await db.from('pedidos_reemplazos')
      .select('id, tipo, nombre_falta, nombre_reemplazo, cantidad, pide, hay, pedida, variedades, estado, orden')
      .eq('pedido_id', pedidoId)
      .in('estado', CAMBIOS_ABIERTOS);
    if (r?.error) return [];
    data = r?.data;
  } catch { return []; }
  if (!Array.isArray(data)) return [];
  return (data as any[])
    .sort((a, b) => Number(a.orden ?? 0) - Number(b.orden ?? 0))
    .map((c) => ({
      id: String(c.id),
      tipo: c.tipo === 'variedad' ? 'variedad' : 'parecido',
      falta: String(c.nombre_falta ?? 'un producto'),
      reemplazo: c.nombre_reemplazo ? String(c.nombre_reemplazo) : null,
      cantidad: numeroONulo(c.cantidad),
      pide: numeroONulo(c.pide),
      hay: numeroONulo(c.hay),
      pedida: c.pedida ? String(c.pedida) : null,
      variedades: Array.isArray(c.variedades) ? c.variedades.map(String) : [],
      estado: String(c.estado),
    }));
}

const queSeOfrecio = (c: CambioAbierto) => (c.tipo === 'variedad'
  ? `qué variedad quiere de ${c.falta}${c.pedida ? ` (pidió ${c.pedida})` : ''}`
  : `si le sirve ${c.reemplazo ?? 'el parecido'} en lugar de ${c.falta}`);

export function mensajeDeCambiosAbiertos(cambios: CambioAbierto[]): string {
  if (cambios.length === 1) return `Falta anotar lo que dijo el cliente: ${queSeOfrecio(cambios[0])}. Anotá si dijo que sí o que no y seguí.`;
  return `Falta anotar lo que dijo el cliente de ${cambios.length} cambios: ${cambios.map(queSeOfrecio).join('; ')}. Anotá cada uno y seguí.`;
}
