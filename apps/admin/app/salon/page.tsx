import { cookies } from 'next/headers';
import { apiFetch } from '../../lib/api';
import { Pantalla } from '../ui/kit/Pantalla';
import { SalonWorkspace } from '../ui/SalonWorkspace';
import { rolDesdeToken, sucursalDesdeToken } from '../lib/permisos';

export const dynamic = 'force-dynamic';

// Op salón (5/11/2026): armar lo asignado, stock con su lugar y puerta trasera
export default async function Salon() {
  const token = (await cookies()).get('odb_token')?.value;
  const rol = rolDesdeToken(token);
  let proveedores: any[] = [];
  let sucursales: any[] = [];
  try {
    const [rp, rs] = await Promise.all([apiFetch('/proveedores'), apiFetch('/sucursales')]);
    if (rp.ok) proveedores = await rp.json();
    if (rs.ok) sucursales = await rs.json();
  } catch {
    // las pestañas avisan solas si la API no responde
  }
  return (
    <Pantalla activo="/salon">
      <SalonWorkspace
        proveedores={(proveedores ?? []).filter((p: any) => p.activo !== false).map((p: any) => ({ id: p.id, nombre: p.nombre }))}
        sucursales={(sucursales ?? []).map((s: any) => ({ id: s.id, nombre: s.nombre }))}
        sucursalPropia={sucursalDesdeToken(token)}
        verTodos={rol !== 'op_salon'}
      />
    </Pantalla>
  );
}
