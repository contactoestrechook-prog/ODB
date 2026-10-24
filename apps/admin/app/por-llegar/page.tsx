import { Pantalla } from '../ui/kit/Pantalla';
import { apiFetch } from '../../lib/api';
import { PorLlegar } from '../ui/PorLlegar';

export const dynamic = 'force-dynamic';

// Mercadería por llegar: los pedidos aprobados y la fecha que confirmó cada
// proveedor por WhatsApp (23/10/2026). Y la carga del WhatsApp de cada uno.
export default async function PorLlegarPage() {
  let sucursales: { id: string; nombre: string }[] = [];
  try {
    const r = await apiFetch('/sucursales');
    if (r.ok) sucursales = await r.json();
  } catch { /* la pantalla igual abre */ }

  return (
    <Pantalla activo="/por-llegar" ancho="angosto">
      <PorLlegar sucursales={sucursales} />
    </Pantalla>
  );
}
