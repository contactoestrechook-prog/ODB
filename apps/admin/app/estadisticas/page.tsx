import { Header } from '../ui/Header';
import { apiFetch } from '../../lib/api';

const pesos = (n: number) => '$' + Math.round(n).toLocaleString('es-AR');

const MEDIO_LABEL: Record<string, string> = {
  efectivo: 'Efectivo',
  mercadopago: 'Mercado Pago',
  tarjeta: 'Tarjeta',
  cta_cte: 'Cuenta corriente',
};

export const dynamic = 'force-dynamic';

function TablaRanking({
  titulo,
  filas,
  valor,
  formato,
}: {
  titulo: string;
  filas: any[];
  valor: string;
  formato: 'unidades' | 'pesos';
}) {
  const max = Math.max(...filas.map((f) => f[valor]), 1);
  return (
    <section className="rounded-xl bg-white overflow-hidden">
      <h2 className="px-4 py-3 border-b border-black/10 font-medium text-black text-sm">{titulo}</h2>
      <table className="w-full text-sm text-black">
        <tbody>
          {filas.map((f) => (
            <tr key={f.sku} className="border-b border-black/5 last:border-0">
              <td className="px-4 py-2">
                <p className="text-xs">{f.nombre}</p>
                <div className="mt-1 h-1.5 rounded-full bg-[#F0EBE2]">
                  <div
                    className="h-1.5 rounded-full bg-[#B82D25]"
                    style={{ width: `${Math.max((f[valor] / max) * 100, 2)}%` }}
                  />
                </div>
              </td>
              <td className="px-4 py-2 text-right text-xs font-medium whitespace-nowrap w-24">
                {formato === 'pesos' ? pesos(f[valor]) : `${f[valor]} u.`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export default async function Estadisticas() {
  let d: any = null;
  let error: string | null = null;
  try {
    const res = await apiFetch('/estadisticas');
    if (!res.ok) throw new Error(`API respondió ${res.status}`);
    d = await res.json();
  } catch (e) {
    error = e instanceof Error ? e.message : 'Error desconocido';
  }

  if (!d) {
    return (
      <main className="min-h-screen bg-[#F0EBE2]">
        <Header activo="/estadisticas" />
        <div className="max-w-5xl mx-auto p-6">
          <p className="rounded-lg bg-white p-4 text-sm text-[#932A1F]">No pude consultar la API ({error}).</p>
        </div>
      </main>
    );
  }

  const maxDia = Math.max(...d.ventasPorDia.map((v: any) => v.total), 1);
  const totalMedios = d.porMedio.reduce((s: number, m: any) => s + m.total, 0) || 1;

  return (
    <main className="min-h-screen bg-[#F0EBE2]">
      <Header activo="/estadisticas" />
      <div className="max-w-6xl mx-auto p-6 space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="rounded-xl bg-white p-4">
            <p className="text-xs text-black/50">Facturado (30 días)</p>
            <p className="text-xl font-medium text-black">{pesos(d.totales.facturado)}</p>
          </div>
          <div className="rounded-xl bg-white p-4">
            <p className="text-xs text-black/50">Tickets</p>
            <p className="text-xl font-medium text-black">{d.totales.tickets.toLocaleString('es-AR')}</p>
          </div>
          <div className="rounded-xl bg-white p-4">
            <p className="text-xs text-black/50">Ticket promedio</p>
            <p className="text-xl font-medium text-black">{pesos(d.totales.ticketPromedio)}</p>
          </div>
          <div className="rounded-xl bg-[#B82D25] p-4">
            <p className="text-xs text-[#F0EBE2]">Descuentos otorgados</p>
            <p className="text-xl font-medium text-white">{pesos(d.totales.descuentos)}</p>
          </div>
        </div>

        <section className="rounded-xl bg-white p-4">
          <h2 className="font-medium text-black text-sm mb-3">Ventas por día (30 días)</h2>
          <div className="flex items-end gap-[3px] h-36">
            {d.ventasPorDia.map((v: any) => (
              <div
                key={v.fecha}
                className="flex-1 rounded-t bg-[#B82D25] hover:bg-black transition-colors"
                style={{ height: `${Math.max((v.total / maxDia) * 100, 1.5)}%` }}
                title={`${v.fecha}: ${pesos(v.total)} (${v.tickets} tickets)`}
              />
            ))}
          </div>
          <div className="mt-1 flex justify-between text-[10px] text-black/40">
            <span>hace 30 días</span>
            <span>hoy</span>
          </div>
        </section>

        <div className="grid md:grid-cols-2 gap-4">
          <TablaRanking titulo="Más vendidos (unidades)" filas={d.topUnidades} valor="unidades" formato="unidades" />
          <TablaRanking titulo="Más facturación" filas={d.topFacturacion} valor="facturado" formato="pesos" />
          <TablaRanking titulo="Más margen (la plata de verdad)" filas={d.topMargen} valor="margen" formato="pesos" />
          <TablaRanking titulo="Peores (candidatos a liquidar)" filas={d.peores} valor="unidades" formato="unidades" />
        </div>

        <section className="rounded-xl bg-white p-4">
          <h2 className="font-medium text-black text-sm mb-3">Medios de pago (30 días)</h2>
          <div className="flex h-7 rounded-full overflow-hidden">
            {d.porMedio.map((m: any, i: number) => (
              <div
                key={m.medio}
                className={['bg-[#B82D25]', 'bg-black', 'bg-[#932A1F]', 'bg-[#D9D2C5]'][i % 4]}
                style={{ width: `${(m.total / totalMedios) * 100}%` }}
                title={`${MEDIO_LABEL[m.medio] ?? m.medio}: ${pesos(m.total)}`}
              />
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-4 text-xs text-black/60">
            {d.porMedio.map((m: any, i: number) => (
              <span key={m.medio} className="flex items-center gap-1.5">
                <span className={'inline-block h-2.5 w-2.5 rounded-full ' + ['bg-[#B82D25]', 'bg-black', 'bg-[#932A1F]', 'bg-[#D9D2C5]'][i % 4]} />
                {MEDIO_LABEL[m.medio] ?? m.medio} · {pesos(m.total)} ({Math.round((m.total / totalMedios) * 100)} %)
              </span>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
