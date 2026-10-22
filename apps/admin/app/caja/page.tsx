import { cookies } from 'next/headers';
import { apiFetch } from '../../lib/api';
import { rolDesdeToken } from '../lib/permisos';
import { Caja } from './Caja';

export const dynamic = 'force-dynamic';

export default async function PaginaCaja() {
  let sucursales: { id: string; nombre: string; terminales_tarjeta?: string[] }[] = [];
  try {
    const res = await apiFetch('/sucursales');
    if (res.ok) sucursales = await res.json();
  } catch {}

  const rol = rolDesdeToken((await cookies()).get('odb_token')?.value);
  return <Caja sucursales={sucursales} rol={rol} />;
}
