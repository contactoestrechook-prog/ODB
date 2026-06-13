import { Header } from '../ui/Header';
import { apiFetch, API } from '../../lib/api';
import { StockWorkspace } from '../ui/StockWorkspace';

export const dynamic = 'force-dynamic';

export default async function Stock() {
  let resumen: any = {};
  let valorizacion: any = { rubros: [], sucursales: [] };
  let criticos: any[] = [];
  let vencimientos: any = null;
  let transferencias: any[] = [];
  let sucursales: { id: string; nombre: string }[] = [];
  let error: string | null = null;
  try {
    const [rr, rv, rc, rven, rt, rs] = await Promise.all([
      apiFetch('/stock/resumen'),
      apiFetch('/stock/valorizacion'),
      apiFetch('/stock/bajo-minimo'),
      apiFetch('/vencimientos'),
      apiFetch('/stock/transferencias'),
      apiFetch('/sucursales'),
    ]);
    if (rr.ok) resumen = await rr.json();
    if (rv.ok) valorizacion = await rv.json();
    if (rc.ok) criticos = await rc.json();
    if (rven.ok) vencimientos = await rven.json();
    if (rt.ok) transferencias = await rt.json();
    if (rs.ok) sucursales = await rs.json();
    if (!rr.ok && !rc.ok) throw new Error('La API respondió con error');
  } catch (e) {
    error = e instanceof Error ? e.message : 'Error desconocido';
  }

  return (
    <main className="min-h-screen bg-[#F0EBE2] lg:pl-64">
      <Header activo="/stock" />
      <div className="max-w-6xl mx-auto p-6">
        {error ? (
          <p className="rounded-lg bg-white p-4 text-sm text-[#932A1F]">
            No pude consultar la API ({error}). ¿Está corriendo en {API}?
          </p>
        ) : (
          <StockWorkspace
            resumen={resumen}
            valorizacion={valorizacion}
            criticos={criticos}
            vencimientos={vencimientos}
            sucursales={sucursales}
            transferencias={transferencias}
          />
        )}
      </div>
    </main>
  );
}
