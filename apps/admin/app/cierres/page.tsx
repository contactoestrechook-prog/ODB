import { Pantalla } from '../ui/kit/Pantalla';
import { Aviso } from '../ui/kit';
import { apiFetch } from '../../lib/api';
import { CierresWorkspace } from '../ui/CierresWorkspace';

export const dynamic = 'force-dynamic';

export default async function Cierres() {
  let resumen: any = {};
  let cajas: any[] = [];
  let sesiones: any[] = [];
  let arca: any = { total: 0, configurado: false };
  let empleados: any[] = [];
  let error: string | null = null;
  try {
    const [rr, rc, rs, ra, re] = await Promise.all([
      apiFetch('/caja/resumen'),
      apiFetch('/caja/cajas'),
      apiFetch('/caja/sesiones'),
      apiFetch('/arca/pendientes'),
      apiFetch('/usuarios'),
    ]);
    if (rr.ok) resumen = await rr.json();
    if (rc.ok) cajas = await rc.json();
    if (rs.ok) sesiones = await rs.json();
    if (ra.ok) arca = await ra.json();
    if (re.ok) empleados = await re.json();
    if (!rc.ok && !rs.ok) throw new Error('La API respondió con error');
  } catch (e) {
    error = e instanceof Error ? e.message : 'Error desconocido';
  }

  return (
    <Pantalla activo="/cierres">
      {error ? (
        <Aviso tono="error">No pude consultar la API ({error}).</Aviso>
      ) : (
        <CierresWorkspace resumen={resumen} cajas={cajas} sesiones={sesiones} arca={arca} empleados={empleados} />
      )}
    </Pantalla>
  );
}
