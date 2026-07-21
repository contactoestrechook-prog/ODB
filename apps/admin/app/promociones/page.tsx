import { Header } from '../ui/Header';
import { apiFetch } from '../../lib/api';
import { PromosWorkspace } from '../ui/PromosWorkspace';
import { BotonPromo } from '../ui/BotonPromo';

export const dynamic = 'force-dynamic';

export default async function Promociones() {
  let descuentos: any[] = [];
  let segmentosData: any = { ticketGeneral: 0, segmentos: [] };
  let filtros: any = { categorias: [], marcas: [] };
  let candidatos: any[] = [];
  let error: string | null = null;
  try {
    const [rd, rs, rf, rc] = await Promise.all([
      apiFetch('/descuentos'),
      apiFetch('/descuentos/segmentos'),
      apiFetch('/catalogo/filtros'),
      apiFetch('/estadisticas/promocionables'),
    ]);
    if (!rd.ok) throw new Error(`API respondió ${rd.status}`);
    descuentos = await rd.json();
    if (rs.ok) segmentosData = await rs.json();
    if (rf.ok) filtros = await rf.json();
    if (rc.ok) candidatos = await rc.json();
  } catch (e) {
    error = e instanceof Error ? e.message : 'Error desconocido';
  }

  const orden = { vigente: 0, programado: 1, vencido: 2, inactivo: 3 } as const;
  descuentos.sort((a, b) => (orden[a.estado as keyof typeof orden] ?? 9) - (orden[b.estado as keyof typeof orden] ?? 9));

  return (
    <main className="min-h-screen bg-[#F0EBE2] lg:pl-64">
      <Header activo="/promociones" />
      <div className="max-w-5xl mx-auto p-6 space-y-4">
        {error ? (
          <p className="rounded-lg bg-white p-4 text-sm text-[#932A1F]">No pude consultar la API ({error}).</p>
        ) : (
          <>
            <PromosWorkspace
              descuentos={descuentos}
              segmentos={segmentosData.segmentos}
              ticketGeneral={segmentosData.ticketGeneral}
              categorias={filtros.categorias}
              marcas={filtros.marcas}
            />

            {candidatos.length > 0 && (
              <section className="rounded-xl bg-white overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-black/10">
                  <h2 className="font-medium text-black text-sm">Ideales para promocionar</h2>
                  <span className="text-xs text-black/40">
                    hay que moverlos y el margen banca el descuento
                  </span>
                </div>
                <table className="w-full text-sm text-black">
                  <tbody>
                    {candidatos.map((p: any) => (
                      <tr key={p.sku} className="border-b border-black/5 last:border-0">
                        <td className="px-4 py-2.5">
                          <p className="text-sm">{p.nombre}</p>
                          <p className="text-xs text-black/40">
                            {p.sku} · {p.stockTotal} u. · ${Math.round(p.capital).toLocaleString('es-AR')} inmovilizados
                          </p>
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex flex-wrap gap-1 justify-end">
                            {p.motivos.map((m: string) => (
                              <span
                                key={m}
                                className={
                                  'rounded-full px-2.5 py-0.5 text-xs font-medium ' +
                                  (m.startsWith('vence') ? 'bg-[#B82D25] text-white' : 'bg-[#F0EBE2] text-black')
                                }
                              >
                                {m}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-right text-xs w-36">
                          <BotonPromo sku={p.sku} nombre={p.nombre} porcentaje={p.descuentoSugerido} />
                          <p className="text-black/40 mt-1">margen {Math.round(p.margenPct)} %</p>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}
          </>
        )}
      </div>
    </main>
  );
}
