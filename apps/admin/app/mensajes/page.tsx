import { Pantalla } from '../ui/kit/Pantalla';
import { Aviso } from '../ui/kit';
import { apiFetch } from '../../lib/api';
import { MensajesWorkspace } from '../ui/MensajesWorkspace';

export const dynamic = 'force-dynamic';

export default async function Mensajes() {
  let resumen: any = {};
  let solicitudes: any[] = [];
  let error: string | null = null;
  try {
    const [rr, rs] = await Promise.all([apiFetch('/mensajes/resumen'), apiFetch('/solicitudes')]);
    if (rr.ok) resumen = await rr.json();
    if (rs.ok) solicitudes = await rs.json();
    if (!rr.ok) throw new Error('La API respondió con error');
  } catch (e) {
    error = e instanceof Error ? e.message : 'Error desconocido';
  }

  return (
    <Pantalla activo="/mensajes">
      {error ? (
        <Aviso tono="error">No pude consultar la API ({error}).</Aviso>
      ) : (
        <MensajesWorkspace resumen={resumen} solicitudesInicial={solicitudes} />
      )}
    </Pantalla>
  );
}
