import { Header } from '../ui/Header';
import { apiFetch, API } from '../../lib/api';
import { CrearPromocion } from '../ui/CrearPromocion';
import { TogglePromo } from '../ui/TogglePromo';

const pesosCorto = (n: number | null) => (n == null ? '—' : '$' + Math.round(n).toLocaleString('es-AR'));

type Descuento = {
  id: string;
  nombre: string;
  alcance: string;
  tipo: string;
  valor: number;
  desde: string;
  hasta: string;
  segmento: string | null;
  medio_pago: string | null;
  estado: 'programado' | 'vigente' | 'vencido' | 'inactivo';
  categoria: { nombre: string } | null;
  marca: { nombre: string } | null;
  producto: { sku: string; nombre: string } | null;
};

const fecha = (iso: string) =>
  new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' });

const valorLabel = (d: Descuento) =>
  d.tipo === 'porcentaje'
    ? `${Math.round(Number(d.valor))} % off`
    : d.tipo === 'monto_fijo'
      ? `$${Math.round(Number(d.valor)).toLocaleString('es-AR')} menos`
      : `a $${Math.round(Number(d.valor)).toLocaleString('es-AR')}`;

const alcanceLabel = (d: Descuento) =>
  d.alcance === 'global'
    ? 'Toda la tienda'
    : d.alcance === 'categoria'
      ? `Categoría: ${d.categoria?.nombre ?? '—'}`
      : d.alcance === 'marca'
        ? `Marca: ${d.marca?.nombre ?? '—'}`
        : `${d.producto?.nombre ?? '—'}`;

const ESTADO_ESTILO: Record<string, string> = {
  vigente: 'bg-[#B82D25] text-white',
  programado: 'bg-black text-white',
  vencido: 'bg-[#F0EBE2] text-black/50',
  inactivo: 'bg-[#F0EBE2] text-black/50',
};

export const dynamic = 'force-dynamic';

export default async function Promociones() {
  let descuentos: Descuento[] = [];
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
  descuentos.sort((a, b) => orden[a.estado] - orden[b.estado]);

  return (
    <main className="min-h-screen bg-[#F0EBE2] lg:pl-64">
      <Header activo="/promociones" />
      <div className="max-w-5xl mx-auto p-6 space-y-5">
        {/* segmentos por ticket promedio + acción de crear */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="text-sm text-black/60">
              Ticket promedio general: <strong className="text-black">{pesosCorto(segmentosData.ticketGeneral)}</strong>
            </p>
            <p className="text-xs text-black/40 mt-0.5">El precio con descuento se aplica solo al segmento elegido.</p>
          </div>
          <CrearPromocion
            categorias={filtros.categorias}
            marcas={filtros.marcas}
            segmentos={segmentosData.segmentos}
            ticketGeneral={segmentosData.ticketGeneral}
          />
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {(segmentosData.segmentos ?? []).map((s: any) => {
            const alto = s.ticketPromedio != null && s.ticketPromedio >= segmentosData.ticketGeneral * 1.2;
            const bajo = s.ticketPromedio != null && s.ticketPromedio <= segmentosData.ticketGeneral * 0.8;
            return (
              <div key={s.segmento} className="rounded-xl bg-white p-3.5 border border-black/[0.04]">
                <p className="text-xs font-medium text-black">{s.etiqueta}</p>
                <p className="text-lg font-semibold text-black mt-1 leading-none">{pesosCorto(s.ticketPromedio)}</p>
                <p className="text-[11px] text-black/40 mt-1">ticket prom · {s.clientes} cli.</p>
                {alto && <p className="text-[10px] text-emerald-700 mt-1 font-medium">↑ sobre el promedio</p>}
                {bajo && <p className="text-[10px] text-[#B82D25] mt-1 font-medium">↓ bajo el promedio</p>}
              </div>
            );
          })}
        </div>

        {error ? (
          <p className="rounded-lg bg-white p-4 text-sm text-[#932A1F]">
            No pude consultar la API ({error}).
          </p>
        ) : (
          <div className="overflow-hidden rounded-xl bg-white">
            <div className="flex items-center justify-between px-4 py-3 border-b border-black/10">
              <h2 className="font-medium text-black">Promociones y descuentos</h2>
              <span className="text-xs text-black/50">
                {descuentos.filter((d) => d.estado === 'vigente').length} vigentes ·{' '}
                {descuentos.filter((d) => d.estado === 'programado').length} programadas
              </span>
            </div>
            <table className="w-full text-sm text-black">
              <thead>
                <tr className="text-left text-xs text-black/50 border-b border-black/5">
                  <th className="px-4 py-2 font-medium">Promoción</th>
                  <th className="px-4 py-2 font-medium">Alcance</th>
                  <th className="px-4 py-2 font-medium">Beneficio</th>
                  <th className="px-4 py-2 font-medium">Vigencia</th>
                  <th className="px-4 py-2 font-medium text-right">Estado</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {descuentos.map((d) => (
                  <tr key={d.id} className="border-b border-black/5 last:border-0">
                    <td className="px-4 py-3">
                      <p className="font-medium">{d.nombre}</p>
                      <p className="text-xs text-black/50">
                        {[
                          (d as any).solo_comunidad && '🔒 solo Comunidad ODB',
                          d.segmento && `solo clientes ${d.segmento}`,
                          d.medio_pago && `pagando con ${d.medio_pago}`,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-black/70">{alcanceLabel(d)}</td>
                    <td className="px-4 py-3 font-medium text-[#932A1F]">{valorLabel(d)}</td>
                    <td className="px-4 py-3 text-black/70">
                      {fecha(d.desde)} → {fecha(d.hasta)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${ESTADO_ESTILO[d.estado]}`}
                      >
                        {d.estado}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {d.estado !== 'vencido' && <TogglePromo id={d.id} activo={d.estado !== 'inactivo'} />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}
