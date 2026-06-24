import { Header } from '../ui/Header';
import { apiFetch } from '../../lib/api';
import { AgenteWorkspace } from '../ui/AgenteWorkspace';

export const dynamic = 'force-dynamic';

export default async function Agente() {
  let resumen: any = {};
  let tareas: any[] = [];
  let error: string | null = null;
  try {
    const [rr, rt] = await Promise.all([apiFetch('/agente/resumen'), apiFetch('/agente/tareas')]);
    if (rr.ok) resumen = await rr.json();
    if (rt.ok) tareas = await rt.json();
    if (!rr.ok && !rt.ok) throw new Error('La API respondió con error');
  } catch (e) {
    error = e instanceof Error ? e.message : 'Error desconocido';
  }

  return (
    <main className="min-h-screen bg-[#F0EBE2] lg:pl-64">
      <Header activo="/agente" />
      <div className="max-w-4xl mx-auto p-6">
        {error ? (
          <p className="rounded-lg bg-white p-4 text-sm text-[#932A1F]">No pude consultar la API ({error}).</p>
        ) : (
          <AgenteWorkspace resumenInicial={resumen} tareasIniciales={tareas} />
        )}
      </div>
    </main>
  );
}
