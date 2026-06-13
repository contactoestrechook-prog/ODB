import Link from 'next/link';
import { Header } from '../ui/Header';
import { apiFetch } from '../../lib/api';
import { EmitirComprobante } from '../ui/EmitirComprobante';

const pesos = (n: number) => '$' + Math.round(n).toLocaleString('es-AR');

const TIPOS: Record<string, string> = {
  FA: 'Factura A', FB: 'Factura B', FC: 'Factura C',
  NCA: 'N. crédito A', NCB: 'N. crédito B', NCC: 'N. crédito C',
  NDA: 'N. débito A', NDB: 'N. débito B', NDC: 'N. débito C',
  REM: 'Remito', REC: 'Recibo', ANT: 'Anticipo', SIN: 'Interno',
};

const CHIP: Record<string, string> = {
  F: 'bg-black text-white',
  N: 'bg-[#B82D25]/10 text-[#932A1F]',
  R: 'bg-sky-100 text-sky-900',
  A: 'bg-amber-100 text-amber-900',
  S: 'bg-black/10 text-black/70',
};

export const dynamic = 'force-dynamic';

export default async function Facturacion({
  searchParams,
}: {
  searchParams: Promise<{ tipo?: string; buscar?: string; venta?: string; total?: string }>;
}) {
  const params = await searchParams;
  const qs = new URLSearchParams();
  if (params.tipo) qs.set('tipo', params.tipo);
  if (params.buscar) qs.set('buscar', params.buscar);

  const [rc, rs, rcu] = await Promise.all([
    apiFetch(`/facturacion/comprobantes?${qs}`),
    apiFetch('/sucursales'),
    apiFetch('/facturacion/cuentas'),
  ]);
  const comprobantes: any[] = rc.ok ? await rc.json() : [];
  const sucursales = rs.ok ? await rs.json() : [];
  const cuentas: any[] = rcu.ok ? await rcu.json() : [];
  const porCobrar = cuentas.reduce((s, c) => s + Math.max(c.saldo, 0), 0);

  const hoy = new Date().toISOString().slice(0, 10);
  const facturadoHoy = comprobantes
    .filter((c) => c.emitido_en.slice(0, 10) === hoy && ['FA', 'FB', 'FC'].includes(c.tipo) && c.estado === 'emitido')
    .reduce((s, c) => s + Number(c.total), 0);

  return (
    <main className="min-h-screen bg-[#F0EBE2] lg:pl-64">
      <Header activo="/facturacion" />
      <div className="max-w-6xl mx-auto p-6 space-y-5">
        {/* resumen + acciones */}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex gap-8">
            <div>
              <p className="text-2xl font-semibold text-black leading-none">{pesos(facturadoHoy)}</p>
              <p className="text-xs text-black/45 mt-1">facturado hoy</p>
            </div>
            <Link href="/facturacion/cuentas" className="group">
              <p className="text-2xl font-semibold text-[#B82D25] leading-none">{pesos(porCobrar)}</p>
              <p className="text-xs text-black/45 mt-1 group-hover:text-[#B82D25]">por cobrar (cta. cte.) →</p>
            </Link>
            <div>
              <p className="text-2xl font-semibold text-black leading-none">{comprobantes.length}</p>
              <p className="text-xs text-black/45 mt-1">comprobantes recientes</p>
            </div>
          </div>
          <EmitirComprobante
            sucursales={sucursales}
            ventaInicial={params.venta ? { id: params.venta, total: Number(params.total ?? 0) } : null}
          />
        </div>

        {/* filtros */}
        <form className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            name="buscar"
            defaultValue={params.buscar ?? ''}
            placeholder="Número, cliente o documento…"
            className="flex-1 min-w-48 rounded-full border border-[#B82D25] bg-white px-4 py-2 text-sm text-black outline-none focus:ring-2 focus:ring-[#B82D25]/40"
          />
          <select name="tipo" defaultValue={params.tipo ?? ''} className="rounded-lg border border-black/15 bg-white px-2.5 py-2 text-sm text-black">
            <option value="">Todos los tipos</option>
            {Object.entries(TIPOS).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
          <button type="submit" className="rounded-full bg-[#B82D25] px-5 py-2 text-sm font-medium text-white hover:bg-[#932A1F]">
            Filtrar
          </button>
          {(params.tipo || params.buscar) && (
            <Link href="/facturacion" className="text-xs text-black/50 underline">limpiar</Link>
          )}
        </form>

        {/* listado */}
        <section className="rounded-xl bg-white overflow-hidden">
          <table className="w-full text-sm text-black">
            <thead>
              <tr className="border-b border-black/10 text-left text-xs text-black/50">
                <th className="px-4 py-3 font-medium">Comprobante</th>
                <th className="px-4 py-3 font-medium">Receptor</th>
                <th className="px-4 py-3 font-medium">Fecha</th>
                <th className="px-4 py-3 font-medium text-center">CAE</th>
                <th className="px-4 py-3 font-medium text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {comprobantes.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-black/40 text-sm">
                    Sin comprobantes todavía. Emití el primero con el botón de arriba.
                  </td>
                </tr>
              )}
              {comprobantes.map((c) => (
                <tr key={c.id} className={`border-b border-black/5 last:border-0 hover:bg-[#F0EBE2]/40 ${c.estado === 'anulado' ? 'opacity-45' : ''}`}>
                  <td className="px-4 py-2.5">
                    <Link href={`/facturacion/${c.id}`} className="flex items-center gap-2">
                      <span className={`text-[11px] font-medium rounded-full px-2 py-0.5 ${CHIP[c.tipo[0]] ?? CHIP.S}`}>
                        {TIPOS[c.tipo] ?? c.tipo}
                      </span>
                      <span className="font-mono text-xs">
                        {String(c.punto_venta).padStart(4, '0')}-{String(c.numero).padStart(8, '0')}
                      </span>
                      {c.estado === 'anulado' && <span className="text-[10px] text-[#B82D25] font-medium">ANULADO</span>}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-xs">
                    {c.cliente?.razon_social ?? c.cliente?.nombre ?? c.receptor?.nombre ?? 'Consumidor final'}
                    {c.condicion_pago === 'cta_cte' && <span className="ml-2 text-[10px] rounded-full bg-amber-100 text-amber-900 px-1.5 py-0.5">CTA CTE</span>}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-black/50">
                    {new Date(c.emitido_en).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  </td>
                  <td className="px-4 py-2.5 text-center text-xs">
                    {['FA', 'FB', 'FC', 'NCA', 'NCB', 'NCC', 'NDA', 'NDB', 'NDC'].includes(c.tipo)
                      ? c.cae
                        ? <span className="text-emerald-700">✓</span>
                        : <span className="text-amber-600" title="Pendiente de ARCA (falta el certificado)">pend.</span>
                      : <span className="text-black/25">—</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right font-medium whitespace-nowrap">{pesos(c.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </main>
  );
}
