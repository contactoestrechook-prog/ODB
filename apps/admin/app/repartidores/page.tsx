import { Header } from '../ui/Header';
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
    <main className="min-h-screen bg-[#F0EBE2] lg:pl-64">
      <Header activo="/repartidores" />
      <div className="p-4 lg:p-6 max-w-4xl">
        <RepartidoresWorkspace inicial={repartidores} />
      </div>
    </main>
  );
}
