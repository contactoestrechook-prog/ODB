import { Header } from '../ui/Header';
import { apiFetch } from '../../lib/api';
import { RecepcionWorkspace } from '../ui/RecepcionWorkspace';

export const dynamic = 'force-dynamic';

export default async function Recepcion() {
  let proveedores: any[] = [];
  let sucursales: any[] = [];
  let error: string | null = null;
  try {
    const [rp, rs] = await Promise.all([apiFetch('/proveedores'), apiFetch('/sucursales')]);
    if (rp.ok) proveedores = await rp.json();
    if (rs.ok) sucursales = await rs.json();
    if (!rp.ok) throw new Error('La API respondió con error');
  } catch (e) {
    error = e instanceof Error ? e.message : 'Error desconocido';
  }

  return (
    <main className="min-h-screen bg-[#F0EBE2] lg:pl-64">
      <Header activo="/recepcion" />
      <div className="max-w-3xl mx-auto p-6">
        {error ? (
          <p className="rounded-lg bg-white p-4 text-sm text-[#932A1F]">No pude consultar la API ({error}).</p>
        ) : (
          <RecepcionWorkspace proveedores={proveedores} sucursales={sucursales} />
        )}
      </div>
    </main>
  );
}
