import { Pantalla } from '../ui/kit/Pantalla';
import { Aviso } from '../ui/kit';
import { apiFetch } from '../../lib/api';
import { ComparadorWorkspace } from '../ui/ComparadorWorkspace';

export const dynamic = 'force-dynamic';

export default async function Comparador() {
  let comparacion: any[] = [];
  let directorio: any[] = [];
  let stats: any = null;
  let error: string | null = null;
  try {
    const [rc, rd, rs] = await Promise.all([apiFetch('/comparador'), apiFetch('/comparador/directorio'), apiFetch('/comparador/stats')]);
    if (rc.ok) comparacion = await rc.json();
    if (rd.ok) directorio = await rd.json();
    if (rs.ok) stats = await rs.json();
    if (!rc.ok && !rd.ok) throw new Error('La API respondió con error');
  } catch (e) {
    error = e instanceof Error ? e.message : 'Error desconocido';
  }

  return (
    <Pantalla activo="/comparador">
      {error ? (
        <Aviso tono="error">No pude consultar la API ({error}).</Aviso>
      ) : (
        <ComparadorWorkspace comparacion={comparacion} directorio={directorio} stats={stats} />
      )}
    </Pantalla>
  );
}
