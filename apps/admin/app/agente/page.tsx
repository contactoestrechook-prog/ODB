import { Pantalla } from '../ui/kit/Pantalla';
import { Aviso } from '../ui/kit';
import { apiFetch } from '../../lib/api';
import { AgenteWorkspace } from '../ui/AgenteWorkspace';
import ImportarFotosProveedor from '../ui/ImportarFotosProveedor';

export const dynamic = 'force-dynamic';

export default async function Agente() {
  let resumen: any = {};
  let tareas: any[] = [];
  let error: string | null = null;
  try {
    const [rr, rt] = await Promise.all([apiFetch('/agente/resumen'), apiFetch('/agente/tareas')]);
    if (rr.ok) resumen = await rr.json();
    if (rt.ok) tareas = await rt.json();
    if (!rr.ok && !rt.ok) throw new Error('La API respondió con error');
  } catch (e) {
    error = e instanceof Error ? e.message : 'Error desconocido';
  }

  return (
    <Pantalla activo="/agente">
      {error ? (
        <Aviso tono="error">No pude consultar la API ({error}).</Aviso>
      ) : (
        <>
          <AgenteWorkspace resumenInicial={resumen} tareasIniciales={tareas} />
          <ImportarFotosProveedor />
        </>
      )}
    </Pantalla>
  );
}
