import { Header } from '../ui/Header';
import { apiFetch } from '../../lib/api';
import { PromosWorkspace } from '../ui/PromosWorkspace';

export const dynamic = 'force-dynamic';

export default async function Promociones() {
  let descuentos: any[] = [];
  let segmentosData: any = { ticketGeneral: 0, segmentos: [] };
  let filtros: any = { categorias: [], marcas: [] };
  let error: string | null = null;
  try {
    const [rd, rs, rf] = await Promise.all([
      apiFetch('/descuentos'),
      apiFetch('/descuentos/segmentos'),
      apiFetch('/catalogo/filtros'),
    ]);
    if (!rd.ok) throw new Error(`API respondió ${rd.status}`);
    descuentos = await rd.json();
    if (rs.ok) segmentosData = await rs.json();
    if (rf.ok) filtros = await rf.json();
  } catch (e) {
    error = e instanceof Error ? e.message : 'Error desconocido';
  }

  const orden = { vigente: 0, programado: 1, vencido: 2, inactivo: 3 } as const;
  descuentos.sort((a, b) => (orden[a.estado as keyof typeof orden] ?? 9) - (orden[b.estado as keyof typeof orden] ?? 9));

  return (
    <main className="min-h-screen bg-[#F0EBE2] lg:pl-64">
      <Header activo="/promociones" />
      <div className="max-w-5xl mx-auto p-6">
        {error ? (
          <p className="rounded-lg bg-white p-4 text-sm text-[#932A1F]">No pude consultar la API ({error}).</p>
        ) : (
          <PromosWorkspace
            descuentos={descuentos}
            segmentos={segmentosData.segmentos}
            ticketGeneral={segmentosData.ticketGeneral}
            categorias={filtros.categorias}
            marcas={filtros.marcas}
          />
        )}
      </div>
    </main>
  );
}
