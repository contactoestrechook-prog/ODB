import { Header } from '../ui/Header';
import { BotonAnular } from '../ui/BotonAnular';
import { apiFetch, API } from '../../lib/api';

type Venta = {
  id: string;
  canal: string;
  estado: string;
  subtotal: number;
  descuento: number;
  total: number;
  vendida_en: string;
  sucursal: { nombre: string } | null;
  cliente: { dni: string; tipo: string } | null;
  items: { cantidad: number; producto: { nombre: string } | null }[];
  pagos: { medio: string; monto: number }[];
};

type Resumen = {
  tickets: number;
  facturado: number;
  descuentos: number;
  ticketPromedio: number;
  porSucursal: Record<string, { facturado: number; tickets: number }>;
};

const pesos = (n: number) => '$' + Math.round(Number(n)).toLocaleString('es-AR');

const MEDIO_LABEL: Record<string, string> = {
  efectivo: 'Efectivo',
  mercadopago: 'MP',
  tarjeta: 'Tarjeta',
  cta_cte: 'Cta. cte.',
};

const TIPO_CLIENTE_ESTILO: Record<string, string> = {
  vip: 'bg-black text-white',
  frecuente: 'bg-[#B82D25] text-white',
  mayorista: 'bg-black text-white',
  ocasional: 'bg-[#F0EBE2] text-black',
  nuevo: 'bg-[#F0EBE2] text-black/60',
};

export const dynamic = 'force-dynamic';

export default async function Ventas() {
  let ventas: Venta[] = [];
  let resumen: Resumen | null = null;
  let error: string | null = null;
  try {
    const [rv, rr] = await Promise.all([
      apiFetch('/ventas?limite=30'),
      apiFetch('/ventas/resumen'),
    ]);
    if (!rv.ok || !rr.ok) throw new Error('La API respondió con error');
    ventas = await rv.json();
    resumen = await rr.json();
  } catch (e) {
    error = e instanceof Error ? e.message : 'Error desconocido';
  }

  return (
    <main className="min-h-screen bg-[#F0EBE2] lg:pl-64">
      <Header activo="/ventas" />
      <div className="max-w-5xl mx-auto p-6 space-y-6">
        {error && (
          <p className="rounded-lg bg-white p-4 text-sm text-[#932A1F]">
            No pude consultar la API ({error}).
          </p>
        )}

        {resumen && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="rounded-xl bg-white p-4">
              <p className="text-xs text-black/50">Facturado hoy</p>
              <p className="text-xl font-medium text-black">{pesos(resumen.facturado)}</p>
            </div>
            <div className="rounded-xl bg-white p-4">
              <p className="text-xs text-black/50">Tickets</p>
              <p className="text-xl font-medium text-black">{resumen.tickets}</p>
            </div>
            <div className="rounded-xl bg-white p-4">
              <p className="text-xs text-black/50">Ticket promedio</p>
              <p className="text-xl font-medium text-black">{pesos(resumen.ticketPromedio)}</p>
            </div>
            <div className="rounded-xl bg-[#B82D25] p-4">
              <p className="text-xs text-[#F0EBE2]">Descuentos otorgados</p>
              <p className="text-xl font-medium text-white">{pesos(resumen.descuentos)}</p>
            </div>
          </div>
        )}

        <section className="rounded-xl bg-white overflow-hidden">
          <h2 className="px-4 py-3 border-b border-black/10 font-medium text-black">
            Últimas ventas
          </h2>
          <table className="w-full text-sm text-black">
            <tbody>
              {ventas.map((v) => (
                <tr key={v.id} className="border-b border-black/5 last:border-0 align-top">
                  <td className="px-4 py-3 text-xs text-black/50 w-28">
                    {new Date(v.vendida_en).toLocaleString('es-AR', {
                      day: '2-digit',
                      month: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                    <p className="mt-1">{v.sucursal?.nombre}</p>
                  </td>
                  <td className="px-4 py-3">
                    <p>
                      {v.items
                        .map((i) => `${i.producto?.nombre ?? '—'} × ${Math.round(Number(i.cantidad))}`)
                        .join(' · ')}
                    </p>
                    <p className="text-xs text-black/50 mt-1">
                      {v.pagos.map((p) => `${MEDIO_LABEL[p.medio] ?? p.medio} ${pesos(p.monto)}`).join(' + ')}
                      {Number(v.descuento) > 0 && (
                        <span className="text-[#932A1F]"> · ahorró {pesos(v.descuento)}</span>
                      )}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    {v.cliente ? (
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${TIPO_CLIENTE_ESTILO[v.cliente.tipo] ?? ''}`}
                      >
                        {v.cliente.tipo} · {v.cliente.dni}
                      </span>
                    ) : (
                      <span className="text-xs text-black/40">sin identificar</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right font-medium whitespace-nowrap">
                    {v.estado === 'anulada' ? (
                      <span className="line-through text-black/40">{pesos(v.total)}</span>
                    ) : (
                      pesos(v.total)
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {v.estado === 'anulada' ? (
                      <span className="rounded-full bg-[#F0EBE2] px-2.5 py-0.5 text-xs text-black/50">
                        anulada · NC emitida
                      </span>
                    ) : (
                      <BotonAnular ventaId={v.id} total={v.total} />
                    )}
                  </td>
                </tr>
              ))}
              {ventas.length === 0 && (
                <tr>
                  <td className="px-4 py-6 text-sm text-black/50">Sin ventas registradas.</td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      </div>
    </main>
  );
}
