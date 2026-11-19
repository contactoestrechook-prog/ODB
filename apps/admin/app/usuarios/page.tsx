import { cookies } from 'next/headers';
import { Pantalla } from '../ui/kit/Pantalla';
import { Vacio } from '../ui/kit';
import { apiFetch } from '../../lib/api';
import { GestionUsuarios } from '../ui/GestionUsuarios';
import { rolesDesdeToken } from '../lib/permisos';

export const dynamic = 'force-dynamic';

export default async function Usuarios() {
  const [resUsuarios, resSucursales] = await Promise.all([
    apiFetch('/usuarios'),
    apiFetch('/usuarios/sucursales'),
  ]);
  const usuarios = resUsuarios.ok ? await resUsuarios.json() : [];
  const sucursales = resSucursales.ok ? await resSucursales.json() : [];
  // administración completa las altas (email, WhatsApp, clave); roles y bajas
  // son del dueño y el gerente (19/11/2026)
  const roles = rolesDesdeToken((await cookies()).get('odb_token')?.value);
  const soloCompletar = !roles.some((r) => r === 'dueno' || r === 'gerente');

  return (
    <Pantalla activo="/usuarios">
      {!resUsuarios.ok ? (
        <Vacio titulo="No tenés permisos para administrar usuarios" texto="Requiere rol dueño, gerente o administrativo." />
      ) : (
        <GestionUsuarios usuarios={usuarios} sucursales={sucursales} soloCompletar={soloCompletar} />
      )}
    </Pantalla>
  );
}
