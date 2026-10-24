import { cookies } from 'next/headers';
import { Pantalla } from '../../ui/kit/Pantalla';
import { apiFetch } from '../../../lib/api';
import { PlanConteo } from '../../ui/PlanConteo';
import { rolDesdeToken, sucursalDesdeToken } from '../../lib/permisos';

export const dynamic = 'force-dynamic';

// Plan de conteo por rubro: la planilla de la pared, en el sistema (24/10/2026).
export default async function PlanConteoPage() {
  const token = (await cookies()).get('odb_token')?.value;
  const rol = rolDesdeToken(token);
  let sucursales: { id: string; nombre: string }[] = [];
  try {
    const r = await apiFetch('/sucursales');
    if (r.ok) sucursales = await r.json();
  } catch { /* la pantalla igual abre */ }
  return (
    <Pantalla activo="/arqueo" ancho="ancho" titulo="Plan de conteo" bajada="Qué rubro cuenta cada uno, semana por semana">
      <PlanConteo sucursales={sucursales} sucursalPropia={sucursalDesdeToken(token)} responsable={rol === 'administrativo' || rol === 'gerente' || rol === 'dueno'} />
    </Pantalla>
  );
}
