import { apiFetch } from '../../lib/api';
import { ContableWorkspace } from '../ui/ContableWorkspace';
import { Aviso } from '../ui/kit';
import { Pantalla } from '../ui/kit/Pantalla';

export const dynamic = 'force-dynamic';

export default async function Contable() {
  let inicial: any = null;
  let error: string | null = null;
  try {
    const res = await apiFetch('/contable');
    if (!res.ok) throw new Error(`API respondió ${res.status}`);
    inicial = await res.json();
  } catch (e) {
    error = e instanceof Error ? e.message : 'Error desconocido';
  }

  return (
    <Pantalla activo="/contable">
      {error ? (
        <Aviso tono="error">No pude consultar la API ({error}).</Aviso>
      ) : (
        <ContableWorkspace inicial={inicial} />
      )}
    </Pantalla>
  );
}
