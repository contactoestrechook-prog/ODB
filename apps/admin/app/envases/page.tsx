import { Header } from '../ui/Header';
import { apiFetch } from '../../lib/api';
import { EnvasesWorkspace } from '../ui/EnvasesWorkspace';

export const dynamic = 'force-dynamic';

export default async function EnvasesPage() {
  let resumen: any = null;
  let saldos: any[] = [];
  let tipos: any[] = [];
  let error: string | null = null;
  try {
    const [rr, rs, rt] = await Promise.all([apiFetch('/envases/resumen'), apiFetch('/envases/saldos'), apiFetch('/envases/tipos')]);
    if (rr.ok) resumen = await rr.json();
    if (rs.ok) saldos = await rs.json();
    if (rt.ok) tipos = await rt.json();
    if (!rr.ok) throw new Error('La API respondió con error');
  } catch (e) {
    error = e instanceof Error ? e.message : 'Error desconocido';
  }

  return (
    <main className="min-h-screen bg-[#F0EBE2] lg:pl-64">
      <Header activo="/envases" />
      <div className="max-w-5xl mx-auto p-6">
        {error ? (
          <p className="rounded-lg bg-white p-4 text-sm text-[#932A1F]">No pude consultar la API ({error}).</p>
        ) : (
          <EnvasesWorkspace resumen={resumen} saldos={saldos} tipos={tipos} />
        )}
      </div>
    </main>
  );
}
