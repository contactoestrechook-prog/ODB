import { cookies } from 'next/headers';
import { Pantalla } from '../ui/kit/Pantalla';
import { apiFetch } from '../../lib/api';
import { ArqueoLista } from '../ui/ArqueoLista';
import { rolDesdeToken, sucursalDesdeToken } from '../lib/permisos';

export const dynamic = 'force-dynamic';

// Arqueo de stock (24/10/2026): la lista, y para gerencia el armado.
export default async function ArqueoPage() {
  const token = (await cookies()).get('odb_token')?.value;
  const rol = rolDesdeToken(token);
  let sucursales: { id: string; nombre: string }[] = [];
  try {
    const r = await apiFetch('/sucursales');
    if (r.ok) sucursales = await r.json();
  } catch { /* la pantalla igual abre */ }
  return (
    <Pantalla activo="/arqueo" ancho="angosto">
      <ArqueoLista sucursales={sucursales} gerencia={rol === 'gerente' || rol === 'dueno'} sucursalPropia={sucursalDesdeToken(token)} />
    </Pantalla>
  );
}
