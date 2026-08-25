import { Header } from '../ui/Header';
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
    <main className="min-h-screen bg-[#F0EBE2] lg:pl-64">
      <Header activo="/pedido-proveedor" />
      <PedidoProveedor sucursales={sucursales} />
    </main>
  );
}
