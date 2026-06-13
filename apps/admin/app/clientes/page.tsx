import { Header } from '../ui/Header';
import { apiFetch } from '../../lib/api';
import { ClientesWorkspace } from '../ui/ClientesWorkspace';

export const dynamic = 'force-dynamic';

export default async function Clientes() {
  let resumen: any = {};
  let segmentosData: any = { ticketGeneral: 0, segmentos: [] };
  let cuentas: any[] = [];
  let error: string | null = null;
  try {
    const [rr, rs, rc] = await Promise.all([
      apiFetch('/clientes/resumen'),
      apiFetch('/descuentos/segmentos'),
      apiFetch('/facturacion/cuentas'),
    ]);
    if (rr.ok) resumen = await rr.json();
    if (rs.ok) segmentosData = await rs.json();
    if (rc.ok) cuentas = await rc.json();
    if (!rr.ok) throw new Error('La API respondió con error');
  } catch (e) {
    error = e instanceof Error ? e.message : 'Error desconocido';
  }

  return (
    <main className="min-h-screen bg-[#F0EBE2] lg:pl-64">
      <Header activo="/clientes" />
      <div className="max-w-5xl mx-auto p-6">
        {error ? (
          <p className="rounded-lg bg-white p-4 text-sm text-[#932A1F]">No pude consultar la API ({error}).</p>
        ) : (
          <ClientesWorkspace
            resumen={resumen}
            segmentos={segmentosData.segmentos}
            ticketGeneral={segmentosData.ticketGeneral}
            cuentas={cuentas}
          />
        )}
      </div>
    </main>
  );
}
