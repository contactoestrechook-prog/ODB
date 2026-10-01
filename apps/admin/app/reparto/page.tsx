import { Pantalla } from '../ui/kit/Pantalla';
import { Aviso } from '../ui/kit';
import { apiFetch } from '../../lib/api';
import { RepartoWorkspace } from '../ui/RepartoWorkspace';

export const dynamic = 'force-dynamic';

export default async function RepartoPage() {
  let repartos: any[] = [];
  let choferes: any[] = [];
  let error: string | null = null;
  try {
    const [rl, rc] = await Promise.all([apiFetch('/repartos'), apiFetch('/repartos/choferes')]);
    if (rl.ok) repartos = await rl.json();
    if (rc.ok) choferes = await rc.json();
    if (!rl.ok) throw new Error('La API respondió con error');
  } catch (e) {
    error = e instanceof Error ? e.message : 'Error desconocido';
  }

  return (
    <Pantalla activo="/reparto" ancho="ancho">
      {error ? (
        <Aviso tono="error">No pude consultar la API ({error}).</Aviso>
      ) : (
        <RepartoWorkspace repartos={repartos} choferes={choferes} />
      )}
    </Pantalla>
  );
}
