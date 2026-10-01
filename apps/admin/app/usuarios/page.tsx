import { Pantalla } from '../ui/kit/Pantalla';
import { Vacio } from '../ui/kit';
import { apiFetch } from '../../lib/api';
import { GestionUsuarios } from '../ui/GestionUsuarios';

export const dynamic = 'force-dynamic';

export default async function Usuarios() {
  const [resUsuarios, resSucursales] = await Promise.all([
    apiFetch('/usuarios'),
    apiFetch('/usuarios/sucursales'),
  ]);
  const usuarios = resUsuarios.ok ? await resUsuarios.json() : [];
  const sucursales = resSucursales.ok ? await resSucursales.json() : [];

  return (
    <Pantalla activo="/usuarios">
      {!resUsuarios.ok ? (
        <Vacio titulo="No tenés permisos para administrar usuarios" texto="Requiere rol dueño o gerente." />
      ) : (
        <GestionUsuarios usuarios={usuarios} sucursales={sucursales} />
      )}
    </Pantalla>
  );
}
