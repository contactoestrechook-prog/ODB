import { Pantalla } from '../ui/kit/Pantalla';
import { Aviso } from '../ui/kit';
import { apiFetch } from '../../lib/api';
import { EventosWorkspace } from '../ui/EventosWorkspace';

export const dynamic = 'force-dynamic';

export default async function Eventos() {
  let resumen: any = {};
  let oportunidades: any[] = [];
  let eventos: any[] = [];
  let error: string | null = null;
  try {
    const [rr, ro, re] = await Promise.all([apiFetch('/eventos/resumen'), apiFetch('/eventos/oportunidades'), apiFetch('/eventos')]);
    if (rr.ok) resumen = await rr.json();
    if (ro.ok) oportunidades = await ro.json();
    if (re.ok) eventos = await re.json();
    if (!rr.ok) throw new Error('La API respondió con error');
  } catch (e) {
    error = e instanceof Error ? e.message : 'Error desconocido';
  }

  return (
    <Pantalla activo="/eventos">
      {error ? (
        <Aviso tono="error">No pude consultar la API ({error}).</Aviso>
      ) : (
        <EventosWorkspace resumen={resumen} oportunidades={oportunidades} eventos={eventos} />
      )}
    </Pantalla>
  );
}
