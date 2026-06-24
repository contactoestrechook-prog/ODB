import { Header } from '../ui/Header';
import { apiFetch } from '../../lib/api';
import { ChequesWorkspace } from '../ui/ChequesWorkspace';

export const dynamic = 'force-dynamic';

export default async function Cheques() {
  let resumen: any = {};
  let cheques: any[] = [];
  let error: string | null = null;
  try {
    const [rr, rl] = await Promise.all([
      apiFetch('/cheques/resumen'),
      apiFetch('/cheques?limite=200'),
    ]);
    if (rr.ok) resumen = await rr.json();
    if (rl.ok) cheques = await rl.json();
    if (!rr.ok && !rl.ok) throw new Error('La API respondió con error');
  } catch (e) {
    error = e instanceof Error ? e.message : 'Error desconocido';
  }

  return (
    <main className="min-h-screen bg-[#F0EBE2] lg:pl-64">
      <Header activo="/cheques" />
      <div className="max-w-6xl mx-auto p-6">
        {error ? (
          <p className="rounded-lg bg-white p-4 text-sm text-[#932A1F]">No pude consultar la API ({error}).</p>
        ) : (
          <ChequesWorkspace resumen={resumen} cheques={cheques} />
        )}
      </div>
    </main>
  );
}
