import { Pantalla } from '../ui/kit/Pantalla';
import { Aviso } from '../ui/kit';
import { apiFetch } from '../../lib/api';
import { CajaDueno, type Hoja } from '../ui/CajaDueno';

export const dynamic = 'force-dynamic';

// Caja del dueño (25/11/2026): la hoja de Juan Pablo, igual que su Excel.
export default async function CajaDuenoPagina() {
  let hoja: Hoja | null = null;
  let error: string | null = null;
  let sinPermiso = false;
  try {
    const r = await apiFetch('/caja-dueno');
    if (r.status === 403) sinPermiso = true;
    else if (!r.ok) throw new Error(`API respondió ${r.status}`);
    else hoja = (await r.json()) as Hoja;
  } catch (e) {
    error = e instanceof Error ? e.message : 'Error desconocido';
  }

  return (
    <Pantalla activo="/caja-dueno" ancho="ancho">
      {sinPermiso ? (
        <Aviso tono="info">Esta caja la ve Juan Pablo o quien él diga.</Aviso>
      ) : error || !hoja ? (
        <Aviso tono="error">No pude consultar la API ({error ?? 'sin datos'}).</Aviso>
      ) : (
        <CajaDueno inicial={hoja} />
      )}
    </Pantalla>
  );
}
