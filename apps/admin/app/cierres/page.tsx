import { Header } from '../ui/Header';
import { apiFetch } from '../../lib/api';
import { CierresWorkspace } from '../ui/CierresWorkspace';

export const dynamic = 'force-dynamic';

export default async function Cierres() {
  let resumen: any = {};
  let cajas: any[] = [];
  let sesiones: any[] = [];
  let arca: any = { total: 0, configurado: false };
  let error: string | null = null;
  try {
    const [rr, rc, rs, ra] = await Promise.all([
      apiFetch('/caja/resumen'),
      apiFetch('/caja/cajas'),
      apiFetch('/caja/sesiones'),
      apiFetch('/arca/pendientes'),
    ]);
    if (rr.ok) resumen = await rr.json();
    if (rc.ok) cajas = await rc.json();
    if (rs.ok) sesiones = await rs.json();
    if (ra.ok) arca = await ra.json();
    if (!rc.ok && !rs.ok) throw new Error('La API respondió con error');
  } catch (e) {
    error = e instanceof Error ? e.message : 'Error desconocido';
  }

  return (
    <main className="min-h-screen bg-[#F0EBE2] lg:pl-64">
      <Header activo="/cierres" />
      <div className="max-w-5xl mx-auto p-6">
        {error ? (
          <p className="rounded-lg bg-white p-4 text-sm text-[#932A1F]">No pude consultar la API ({error}).</p>
        ) : (
          <CierresWorkspace resumen={resumen} cajas={cajas} sesiones={sesiones} arca={arca} />
        )}
      </div>
    </main>
  );
}
