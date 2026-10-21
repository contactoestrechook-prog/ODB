import { Pantalla } from '../ui/kit/Pantalla';
import { Aviso } from '../ui/kit';
import { apiFetch } from '../../lib/api';
import { EventosWorkspace, type Evento, type OportunidadesEventos, type ResumenEventos } from '../ui/EventosWorkspace';

export const dynamic = 'force-dynamic';

export default async function Eventos() {
  let resumen: ResumenEventos | null = null;
  let oportunidades: OportunidadesEventos | null = null;
  let eventos: Evento[] = [];
  let error: string | null = null;
  try {
    const [rr, ro, re] = await Promise.all([apiFetch('/eventos/resumen'), apiFetch('/eventos/oportunidades'), apiFetch('/eventos')]);
    if (!rr.ok || !re.ok) throw new Error('La API respondió con error');
    resumen = await rr.json();
    eventos = await re.json();
    // si fallan las oportunidades, la pantalla sale igual (la pestaña avisa y deja reintentar)
    if (ro.ok) oportunidades = await ro.json();
  } catch (e) {
    error = e instanceof Error ? e.message : 'Error desconocido';
  }

  return (
    <Pantalla activo="/eventos" ancho="ancho">
      {error ? (
        <Aviso tono="error">No pude consultar la API ({error}).</Aviso>
      ) : (
        <EventosWorkspace resumen={resumen} oportunidades={oportunidades} eventos={Array.isArray(eventos) ? eventos : []} />
      )}
    </Pantalla>
  );
}
