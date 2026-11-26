import { Pantalla } from '../ui/kit/Pantalla';
import { Aviso } from '../ui/kit';
import { apiFetch } from '../../lib/api';
import { CajaDuenoAlDia, type Hoja } from '../ui/CajaDuenoAlDia';

export const dynamic = 'force-dynamic';

// Caja del dueño (25/11/2026), al día (26/11/2026): Juan Pablo no quería una copia del Excel,
// quería algo práctico. Cuánto tiene, anotar escribiendo o dictando como lo diría, y las
// cuentas del mes hechas.
export default async function CajaDuenoPagina({ searchParams }: { searchParams: Promise<{ anotar?: string }> }) {
  // ?anotar=…: la frase ya escrita (un atajo de dictado del celular), se confirma igual
  const { anotar } = await searchParams;
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
    <Pantalla activo="/caja-dueno" ancho="angosto">
      {sinPermiso ? (
        <Aviso tono="info">Esta caja la ve Juan Pablo o quien él diga.</Aviso>
      ) : error || !hoja ? (
        <Aviso tono="error">No pude consultar la API ({error ?? 'sin datos'}).</Aviso>
      ) : (
        <CajaDuenoAlDia inicial={hoja} anotar={typeof anotar === 'string' ? anotar : ''} />
      )}
    </Pantalla>
  );
}
