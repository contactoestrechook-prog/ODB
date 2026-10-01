import { apiFetch } from '../../lib/api';
import { ArcaWorkspace } from '../ui/ArcaWorkspace';
import { PinGate } from '../ui/PinGate';
import { Aviso } from '../ui/kit';
import { Pantalla } from '../ui/kit/Pantalla';

export const dynamic = 'force-dynamic';

export default async function Arca() {
  let estado: any = { configurado: false };
  let contador: any = null;
  let pendientes: any = { comprobantes: [] };
  let error: string | null = null;
  try {
    const [re, rc, rp] = await Promise.all([
      apiFetch('/arca/estado'),
      apiFetch('/arca/contador'),
      apiFetch('/arca/pendientes'),
    ]);
    if (re.ok) estado = await re.json();
    if (rc.ok) contador = await rc.json();
    if (rp.ok) pendientes = await rp.json();
    if (!rc.ok) throw new Error('La API respondió con error');
  } catch (e) {
    error = e instanceof Error ? e.message : 'Error desconocido';
  }

  return (
    <Pantalla activo="/arca">
      {error ? (
        <Aviso tono="error">No pude consultar la API ({error}).</Aviso>
      ) : (
        <PinGate modulo="arca" titulo="ARCA · Facturación">
          <ArcaWorkspace estado={estado} contador={contador} pendientes={pendientes} />
        </PinGate>
      )}
    </Pantalla>
  );
}
