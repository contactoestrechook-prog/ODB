import { Header } from '../ui/Header';
import { apiFetch } from '../../lib/api';
import { EventosWorkspace } from '../ui/EventosWorkspace';

export const dynamic = 'force-dynamic';

export default async function Eventos() {
  let resumen: any = {};
  let oportunidades: any[] = [];
  let eventos: any[] = [];
  let error: string | null = null;
  try {
    const [rr, ro, re] = await Promise.all([apiFetch('/eventos/resumen'), apiFetch('/eventos/oportunidades'), apiFetch('/eventos')]);
    if (rr.ok) resumen = await rr.json();
    if (ro.ok) oportunidades = await ro.json();
    if (re.ok) eventos = await re.json();
    if (!rr.ok) throw new Error('La API respondió con error');
  } catch (e) {
    error = e instanceof Error ? e.message : 'Error desconocido';
  }

  return (
    <main className="min-h-screen bg-[#F0EBE2] lg:pl-64">
      <Header activo="/eventos" />
      <div className="max-w-5xl mx-auto p-6">
        {error ? (
          <p className="rounded-lg bg-white p-4 text-sm text-[#932A1F]">No pude consultar la API ({error}).</p>
        ) : (
          <EventosWorkspace resumen={resumen} oportunidades={oportunidades} eventos={eventos} />
        )}
      </div>
    </main>
  );
}
