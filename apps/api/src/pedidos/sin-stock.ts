import { SupabaseClient } from '@supabase/supabase-js';

// LO QUE EL SISTEMA DA SIN STOCK (Leandro, 20/11/2026: «hay que revisar que
// envió a preparar productos que no están en stock»). El pedido de Andrea
// (DOM-87B017B4EA14, 19/11) se pasó desde la charla con Queso Adler Salame
// (pidió 4, había 1) y Pan Lactal con semillas (había 0): «Pasar a pedido» no
// pudo reservar, lo creó entero sin reserva y solo anotó «no alcanzaba»; la
// caja lo mandó a armar a los 3 minutos sin ver nada y el que armó se enteró en
// la góndola. El pedido sigue entrando (el stock del sistema a veces está mal),
// pero ahora se ve en los tres lugares: al pasarlo a pedido, en la caja y en el
// armado, donde va al «No hay → ¿Tenés algo parecido?».

export type FaltaEnSistema = { productoId: string; nombre: string; pide: number; hay: number };

/**
 * Lo que para el sistema no alcanza. `hay` es lo que hay en la sucursal; si el
 * pedido reservó, lo suyo ya está descontado y se le suma (mismo criterio que
 * resolver_falta_armado).
 */
export function faltasEnSistema(
  items: { productoId: string; nombre: string; cantidad: number }[],
  hayDe: (productoId: string) => number,
  reservado = false,
): FaltaEnSistema[] {
  const salida: FaltaEnSistema[] = [];
  for (const i of items) {
    const pide = Number(i.cantidad) || 0;
    if (pide <= 0) continue;
    const hay = Math.max(0, Math.round(((Number(hayDe(i.productoId)) || 0) + (reservado ? pide : 0)) * 1000) / 1000);
    if (hay < pide - 1e-9) salida.push({ productoId: i.productoId, nombre: i.nombre, pide, hay });
  }
  return salida;
}

const cant = (n: number) => Number(n).toLocaleString('es-AR', { maximumFractionDigits: 3 });
/** «Queso Adler Salame x 100g (pide 4, hay 1)» */
export const lineaDeFalta = (f: FaltaEnSistema) => `${f.nombre} (pide ${cant(f.pide)}, hay ${cant(f.hay)})`;

/** El stock de esos productos, por sucursal: clave «producto|sucursal». De a 100 (van en la dirección del pedido). */
export async function stockDe(db: SupabaseClient, productoIds: string[]): Promise<Map<string, number>> {
  const ids = [...new Set(productoIds.filter(Boolean))];
  const mapa = new Map<string, number>();
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await db.from('stock').select('producto_id, sucursal_id, cantidad').in('producto_id', ids.slice(i, i + 100));
    if (error) throw new Error(error.message);
    for (const s of (data ?? []) as any[]) mapa.set(`${s.producto_id}|${s.sucursal_id}`, Number(s.cantidad) || 0);
  }
  return mapa;
}
