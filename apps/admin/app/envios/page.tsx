import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

// Envíos pasó a ser la primera sección de Reparto (21/10/2026): es la misma
// tarea (repartidores, quién lleva cada cosa, entregas). Los links viejos a
// /envios siguen andando y llevan ahí, con el pedido marcado si venía uno.
export default async function Envios({ searchParams }: { searchParams: Promise<{ pedido?: string }> }) {
  const { pedido } = await searchParams;
  redirect(pedido ? `/reparto?vista=envios&pedido=${encodeURIComponent(pedido)}` : '/reparto?vista=envios');
}
