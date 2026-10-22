import { apiFetch } from '../../lib/api';
import { Caja } from './Caja';

export const dynamic = 'force-dynamic';

export default async function PaginaCaja() {
  let sucursales: { id: string; nombre: string; terminales_tarjeta?: string[] }[] = [];
  try {
    const res = await apiFetch('/sucursales');
    if (res.ok) sucursales = await res.json();
  } catch {}

  return <Caja sucursales={sucursales} />;
}
