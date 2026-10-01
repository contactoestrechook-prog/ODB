import { Pantalla } from '../ui/kit/Pantalla';
import { apiFetch } from '../../lib/api';
import { RepartidoresWorkspace } from '../ui/RepartidoresWorkspace';

export const dynamic = 'force-dynamic';

export default async function Repartidores() {
  let repartidores: any[] = [];
  try {
    const r = await apiFetch('/gestion/repartidores');
    if (r.ok) repartidores = await r.json();
  } catch {}

  return (
    <Pantalla activo="/repartidores">
      <RepartidoresWorkspace inicial={repartidores} />
    </Pantalla>
  );
}
