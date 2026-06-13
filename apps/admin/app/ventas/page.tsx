import { Header } from '../ui/Header';
import { apiFetch, API } from '../../lib/api';
import { VentasWorkspace } from '../ui/VentasWorkspace';

export const dynamic = 'force-dynamic';

export default async function Ventas() {
  let resumen: any = null;
  let ventas: any[] = [];
  let sucursales: { id: string; nombre: string }[] = [];
  let error: string | null = null;
  try {
    const [rv, rr, rs] = await Promise.all([
      apiFetch('/ventas?limite=40'),
      apiFetch('/ventas/resumen'),
      apiFetch('/sucursales'),
    ]);
    if (!rv.ok) throw new Error(`API respondió ${rv.status}`);
    ventas = await rv.json();
    if (rr.ok) resumen = await rr.json();
    if (rs.ok) sucursales = await rs.json();
  } catch (e) {
    error = e instanceof Error ? e.message : 'Error desconocido';
  }

  return (
    <main className="min-h-screen bg-[#F0EBE2] lg:pl-64">
      <Header activo="/ventas" />
      <div className="max-w-5xl mx-auto p-6">
        {error ? (
          <p className="rounded-lg bg-white p-4 text-sm text-[#932A1F]">No pude consultar la API ({error}). ¿Está corriendo en {API}?</p>
        ) : (
          <VentasWorkspace resumen={resumen} ventas={ventas} sucursales={sucursales} />
        )}
      </div>
    </main>
  );
}
