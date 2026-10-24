import { cookies } from 'next/headers';
import { Pantalla } from '../ui/kit/Pantalla';
import { Aviso } from '../ui/kit';
import { apiFetch } from '../../lib/api';
import { ClientesWorkspace } from '../ui/ClientesWorkspace';
import { ClientesSucursal } from '../ui/ClientesSucursal';
import { CobrosAIngresar } from '../ui/CobrosAIngresar';
import { datosDesdeToken } from '../lib/permisos';

export const dynamic = 'force-dynamic';

export default async function Clientes({ searchParams }: { searchParams: Promise<{ sucursal?: string }> }) {
  // menú › Clientes › Sant Thomas / Santa Inés (24/10/2026)
  const { sucursal: s } = await searchParams;
  const sucursal = s === 'st' || s === 'si' ? s : null;
  const rol = datosDesdeToken((await cookies()).get('odb_token')?.value).rol;
  let resumen: any = {};
  let segmentosData: any = { ticketGeneral: 0, segmentos: [] };
  let cuentas: any[] = [];
  let error: string | null = null;
  try {
    const [rr, rs, rc] = await Promise.all([
      apiFetch('/clientes/resumen'),
      apiFetch('/descuentos/segmentos'),
      apiFetch('/facturacion/cuentas'),
    ]);
    if (rr.ok) resumen = await rr.json();
    if (rs.ok) segmentosData = await rs.json();
    if (rc.ok) cuentas = await rc.json();
    if (!rr.ok) throw new Error('La API respondió con error');
  } catch (e) {
    error = e instanceof Error ? e.message : 'Error desconocido';
  }

  return (
    <Pantalla activo={sucursal ? `/clientes?sucursal=${sucursal}` : '/clientes'}>
      <CobrosAIngresar esDueno={rol === 'dueno'} />
      {error ? (
        <Aviso tono="error">No pude consultar la API ({error}).</Aviso>
      ) : sucursal ? (
        <ClientesSucursal sucursal={sucursal} porSucursal={resumen?.porSucursal ?? { st: 0, si: 0, sin: 0 }} />
      ) : (
        <ClientesWorkspace
          resumen={resumen}
          segmentos={segmentosData.segmentos}
          ticketGeneral={segmentosData.ticketGeneral}
          cuentas={cuentas}
        />
      )}
    </Pantalla>
  );
}
