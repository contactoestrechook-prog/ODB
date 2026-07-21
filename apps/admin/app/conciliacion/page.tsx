import { Header } from '../ui/Header';
import { apiFetch } from '../../lib/api';
import { ConciliacionWorkspace } from '../ui/ConciliacionWorkspace';

export const dynamic = 'force-dynamic';

export default async function Conciliacion() {
  let resumen: any = {};
  let pendientes: any[] = [];
  let error: string | null = null;
  try {
    const [rr, rp] = await Promise.all([
      apiFetch('/conciliacion/resumen'),
      apiFetch('/conciliacion?estado=pendiente'),
    ]);
    if (rr.ok) resumen = await rr.json();
    if (rp.ok) pendientes = await rp.json();
    if (!rr.ok && !rp.ok) throw new Error('La API respondió con error');
  } catch (e) {
    error = e instanceof Error ? e.message : 'Error desconocido';
  }

  return (
    <main className="min-h-screen bg-[#F0EBE2] lg:pl-64">
      <Header activo="/conciliacion" />
      <div className="max-w-5xl mx-auto p-6">
        {error ? (
          <p className="rounded-lg bg-white p-4 text-sm text-[#932A1F]">No pude consultar la API ({error}).</p>
        ) : (
          <ConciliacionWorkspace resumen={resumen} pendientes={pendientes} />
        )}
      </div>
    </main>
  );
}
