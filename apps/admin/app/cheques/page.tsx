import { Pantalla } from '../ui/kit/Pantalla';
import { Aviso } from '../ui/kit';
import { apiFetch } from '../../lib/api';
import { ChequesWorkspace } from '../ui/ChequesWorkspace';

export const dynamic = 'force-dynamic';

export default async function Cheques() {
  let resumen: any = {};
  let cheques: any[] = [];
  let error: string | null = null;
  try {
    const [rr, rl] = await Promise.all([
      apiFetch('/cheques/resumen'),
      apiFetch('/cheques?limite=200'),
    ]);
    if (rr.ok) resumen = await rr.json();
    if (rl.ok) cheques = await rl.json();
    if (!rr.ok && !rl.ok) throw new Error('La API respondió con error');
  } catch (e) {
    error = e instanceof Error ? e.message : 'Error desconocido';
  }

  return (
    <Pantalla activo="/cheques" ancho="ancho">
      {error ? (
        <Aviso tono="error">No pude consultar la API ({error}).</Aviso>
      ) : (
        <ChequesWorkspace resumen={resumen} cheques={cheques} />
      )}
    </Pantalla>
  );
}
