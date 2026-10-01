import { Pantalla } from '../ui/kit/Pantalla';
import { apiFetch } from '../../lib/api';
import { PedidoProveedor } from '../ui/PedidoProveedor';

export const dynamic = 'force-dynamic';

// Pensada para el celular: backoffice camina el depósito, elige el proveedor y
// arma el pedido con lo que ve en la góndola. En la compu se ve igual, más ancho.
export default async function PedidoProveedorPage() {
  let sucursales: { id: string; nombre: string }[] = [];
  try {
    const r = await apiFetch('/sucursales');
    if (r.ok) sucursales = await r.json();
  } catch { /* la pantalla igual abre: el API se reintenta desde el cliente */ }

  return (
    <Pantalla activo="/pedido-proveedor" ancho="angosto">
      <PedidoProveedor sucursales={sucursales} />
    </Pantalla>
  );
}
