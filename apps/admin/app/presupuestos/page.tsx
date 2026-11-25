import { cookies } from 'next/headers';
import { Pantalla } from '../ui/kit/Pantalla';
import { Aviso } from '../ui/kit';
import { apiFetch } from '../../lib/api';
import { sucursalDesdeToken } from '../lib/permisos';
import { PresupuestosWorkspace, type PresupuestoFila, type Sucursal } from '../ui/PresupuestosWorkspace';

export const dynamic = 'force-dynamic';

// Presupuestos (25/11/2026): «llama alguien y dice tengo una fiesta en casa…». Los arma
// cualquiera del local y le llegan al cliente por WhatsApp.
export default async function Presupuestos() {
  const miSucursal = sucursalDesdeToken((await cookies()).get('odb_token')?.value);
  let lista: PresupuestoFila[] = [];
  let sucursales: Sucursal[] = [];
  let error: string | null = null;
  try {
    const [rl, rs] = await Promise.all([apiFetch('/presupuestos?filtro=abiertos'), apiFetch('/presupuestos/sucursales')]);
    if (!rl.ok) throw new Error(`API respondió ${rl.status}`);
    lista = (await rl.json()) as PresupuestoFila[];
    if (rs.ok) sucursales = (await rs.json()) as Sucursal[];
  } catch (e) {
    error = e instanceof Error ? e.message : 'Error desconocido';
  }
  return (
    <Pantalla activo="/presupuestos">
      {error ? <Aviso tono="error">No pude consultar la API ({error}).</Aviso> : <PresupuestosWorkspace inicial={lista} sucursales={sucursales} miSucursal={miSucursal} />}
    </Pantalla>
  );
}
