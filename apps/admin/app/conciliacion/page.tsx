import { Pantalla } from '../ui/kit/Pantalla';
import { Aviso } from '../ui/kit';
import { apiFetch } from '../../lib/api';
import { ConciliacionWorkspace } from '../ui/ConciliacionWorkspace';

export const dynamic = 'force-dynamic';

export default async function Conciliacion() {
  let resumen: any = {};
  let pendientes: any[] = [];
  let error: string | null = null;
  try {
    const [rr, rp] = await Promise.all([
      apiFetch('/conciliacion/resumen'),
      apiFetch('/conciliacion?estado=pendiente'),
    ]);
    if (rr.ok) resumen = await rr.json();
    if (rp.ok) pendientes = await rp.json();
    if (!rr.ok && !rp.ok) throw new Error('La API respondió con error');
  } catch (e) {
    error = e instanceof Error ? e.message : 'Error desconocido';
  }

  return (
    <Pantalla activo="/conciliacion">
      {error ? (
        <Aviso tono="error">No pude consultar la API ({error}).</Aviso>
      ) : (
        <ConciliacionWorkspace resumen={resumen} pendientes={pendientes} />
      )}
    </Pantalla>
  );
}
