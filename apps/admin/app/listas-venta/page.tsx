import { Pantalla } from '../ui/kit/Pantalla';
import { apiFetch } from '../../lib/api';
import { ListasVentaWorkspace } from '../ui/ListasVentaWorkspace';

export const dynamic = 'force-dynamic';

export default async function ListasVenta() {
  let listas: any[] = [];
  try {
    const r = await apiFetch('/listas-venta');
    if (r.ok) listas = await r.json();
  } catch {}

  return (
    <Pantalla activo="/listas-venta" ancho="angosto">
      <ListasVentaWorkspace inicial={listas} />
    </Pantalla>
  );
}
