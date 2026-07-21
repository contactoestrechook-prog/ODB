import { Header } from '../ui/Header';
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
    <main className="min-h-screen bg-[#F0EBE2] lg:pl-64">
      <Header activo="/listas-venta" />
      <div className="max-w-3xl mx-auto p-6">
        <ListasVentaWorkspace inicial={listas} />
      </div>
    </main>
  );
}
