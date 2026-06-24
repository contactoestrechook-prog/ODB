import { Header } from '../ui/Header';
import { apiFetch } from '../../lib/api';
import { PedidosWorkspace } from '../ui/PedidosWorkspace';

export const dynamic = 'force-dynamic';

export default async function Pedidos() {
  let pedidos: any[] = [];
  let error: string | null = null;
  try {
    const r = await apiFetch('/pedidos');
    if (r.ok) pedidos = await r.json();
    else throw new Error('La API respondió con error');
  } catch (e) {
    error = e instanceof Error ? e.message : 'Error desconocido';
  }

  return (
    <main className="min-h-screen bg-[#F0EBE2] lg:pl-64">
      <Header activo="/pedidos" />
      <div className="max-w-6xl mx-auto p-6">
        {error ? (
          <p className="rounded-lg bg-white p-4 text-sm text-[#932A1F]">No pude consultar la API ({error}).</p>
        ) : (
          <PedidosWorkspace inicial={pedidos} />
        )}
      </div>
    </main>
  );
}
