import Link from 'next/link';
import { Header } from '../ui/Header';
import { apiFetch } from '../../lib/api';
import { ConfigCliente } from '../ui/ConfigCliente';

const pesos = (n: number) => '$' + Math.round(n).toLocaleString('es-AR');

const TIPOS = ['nuevo', 'ocasional', 'frecuente', 'mayorista', 'vip'];

const TIPO_ESTILO: Record<string, string> = {
  vip: 'bg-black text-white',
  mayorista: 'bg-black text-white',
  frecuente: 'bg-[#B82D25] text-white',
  ocasional: 'bg-[#F0EBE2] text-black',
  nuevo: 'bg-[#F0EBE2] text-black/60',
};

export const dynamic = 'force-dynamic';

type Params = { tipo?: string; buscar?: string; pagina?: string };

export default async function Clientes({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const params = await searchParams;
  let datos: any = { total: 0, pagina: 1, paginas: 1, items: [] };
  let error: string | null = null;
  try {
    const partes = Object.entries(params)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}=${encodeURIComponent(v!)}`);
    const res = await apiFetch(`/clientes${partes.length ? `?${partes.join('&')}` : ''}`);
    if (!res.ok) throw new Error(`API respondió ${res.status}`);
    datos = await res.json();
  } catch (e) {
    error = e instanceof Error ? e.message : 'Error desconocido';
  }

  return (
    <main className="min-h-screen bg-[#F0EBE2] lg:pl-64">
      <Header activo="/clientes" />
      <div className="max-w-5xl mx-auto p-6">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Link
            href="/clientes"
            className={
              'rounded-full px-3 py-1.5 text-xs font-medium ' +
              (!params.tipo ? 'bg-black text-white' : 'bg-white text-black border border-black/15')
            }
          >
            Todos
          </Link>
          {TIPOS.map((t) => (
            <Link
              key={t}
              href={`/clientes?tipo=${t}`}
              className={
                'rounded-full px-3 py-1.5 text-xs font-medium ' +
                (params.tipo === t ? 'bg-[#B82D25] text-white' : 'bg-white text-black border border-black/15')
              }
            >
              {t}
            </Link>
          ))}
          <form className="ml-auto">
            {params.tipo && <input type="hidden" name="tipo" value={params.tipo} />}
            <input
              type="search"
              name="buscar"
              defaultValue={params.buscar ?? ''}
              placeholder="DNI o nombre…"
              className="rounded-full border border-black/15 bg-white px-4 py-2 text-sm text-black outline-none focus:border-[#B82D25]"
            />
          </form>
        </div>

        {error ? (
          <p className="rounded-lg bg-white p-4 text-sm text-[#932A1F]">
            No pude consultar la API ({error}).
          </p>
        ) : (
          <div className="overflow-hidden rounded-xl bg-white">
            <table className="w-full text-sm text-black">
              <thead>
                <tr className="border-b border-black/10 text-left text-xs text-black/50">
                  <th className="px-4 py-3 font-medium">Cliente</th>
                  <th className="px-4 py-3 font-medium">Categoría</th>
                  <th className="px-4 py-3 font-medium text-right">Compras</th>
                  <th className="px-4 py-3 font-medium text-right">Total gastado</th>
                  <th className="px-4 py-3 font-medium text-right">Ticket prom.</th>
                  <th className="px-4 py-3 font-medium text-right">Última compra</th>
                  <th className="px-4 py-3 font-medium text-right">Cuenta cte.</th>
                </tr>
              </thead>
              <tbody>
                {datos.items.map((c: any) => (
                  <tr key={c.id} className="border-b border-black/5 last:border-0">
                    <td className="px-4 py-3">
                      <p className="font-medium">{c.nombre ?? `DNI ${c.dni}`}</p>
                      <p className="text-xs text-black/50">
                        {c.dni}
                        {c.verificado && (
                          <span className="ml-2 rounded-full bg-[#F0EBE2] px-2 py-0.5 text-[10px] text-black">
                            ✓ verificado
                          </span>
                        )}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${TIPO_ESTILO[c.tipo] ?? ''}`}>
                        {c.tipo}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">{c.compras}</td>
                    <td className="px-4 py-3 text-right font-medium">{pesos(c.totalGastado)}</td>
                    <td className="px-4 py-3 text-right text-black/70">{pesos(c.ticketPromedio)}</td>
                    <td className="px-4 py-3 text-right text-xs text-black/50">
                      {c.ultimaCompra
                        ? new Date(c.ultimaCompra).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-3">
                        {c.cta_cte_habilitada && (
                          <Link
                            href={`/facturacion/cuentas/${c.id}`}
                            className="text-xs text-black/50 hover:text-[#B82D25] whitespace-nowrap"
                          >
                            ver saldo
                          </Link>
                        )}
                        <ConfigCliente cliente={c} />
                      </div>
                    </td>
                  </tr>
                ))}
                {datos.items.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-black/50">
                      Sin clientes con este filtro. Los clientes se crean solos al dar el DNI en caja o registrarse en la app.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-black/40">{datos.total} clientes</p>
      </div>
    </main>
  );
}
