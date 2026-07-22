import { Header } from '../ui/Header';
import { apiFetch } from '../../lib/api';
import { TarjetasWorkspace } from '../ui/TarjetasWorkspace';

export const dynamic = 'force-dynamic';

export default async function Tarjetas() {
  let resumen: any = {};
  let pagos: any[] = [];
  let error: string | null = null;
  try {
    const [rr, rp] = await Promise.all([
      apiFetch('/tarjetas/resumen'),
      apiFetch('/tarjetas/pagos'),
    ]);
    if (rr.ok) resumen = await rr.json();
    if (rp.ok) pagos = await rp.json();
    if (!rr.ok) throw new Error('La API respondió con error');
  } catch (e) {
    error = e instanceof Error ? e.message : 'Error desconocido';
  }

  return (
    <main className="min-h-screen bg-[#F0EBE2] lg:pl-64">
      <Header activo="/tarjetas" />
      <div className="max-w-5xl mx-auto p-6">
        {error ? (
          <p className="rounded-lg bg-white p-4 text-sm text-[#932A1F]">No pude consultar la API ({error}).</p>
        ) : (
          <TarjetasWorkspace resumen={resumen} pagos={pagos} />
        )}
      </div>
    </main>
  );
}
