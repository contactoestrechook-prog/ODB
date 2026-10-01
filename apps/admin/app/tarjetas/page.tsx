import { Pantalla } from '../ui/kit/Pantalla';
import { Aviso } from '../ui/kit';
import { apiFetch } from '../../lib/api';
import { TarjetasWorkspace } from '../ui/TarjetasWorkspace';

export const dynamic = 'force-dynamic';

export default async function Tarjetas() {
  let resumen: any = {};
  let pagos: any[] = [];
  let error: string | null = null;
  try {
    const [rr, rp] = await Promise.all([
      apiFetch('/tarjetas/resumen'),
      apiFetch('/tarjetas/pagos'),
    ]);
    if (rr.ok) resumen = await rr.json();
    if (rp.ok) pagos = await rp.json();
    if (!rr.ok) throw new Error('La API respondió con error');
  } catch (e) {
    error = e instanceof Error ? e.message : 'Error desconocido';
  }

  return (
    <Pantalla activo="/tarjetas">
      {error ? (
        <Aviso tono="error">No pude consultar la API ({error}).</Aviso>
      ) : (
        <TarjetasWorkspace resumen={resumen} pagos={pagos} />
      )}
    </Pantalla>
  );
}
