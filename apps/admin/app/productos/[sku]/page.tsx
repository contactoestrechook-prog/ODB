import Link from 'next/link';
import { Header } from '../../ui/Header';
import { apiFetch } from '../../../lib/api';

const pesos = (n: number | null | undefined) =>
  n == null ? '—' : '$' + Math.round(Number(n)).toLocaleString('es-AR');

const fecha = (iso: string) =>
  new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' });

const TIPO_MOV: Record<string, string> = {
  venta: 'Venta',
  devolucion: 'Devolución',
  compra: 'Compra',
  ajuste: 'Ajuste',
  merma: 'Merma',
  transferencia_salida: 'Transf. salida',
  transferencia_entrada: 'Transf. entrada',
};

export const dynamic = 'force-dynamic';

export default async function FichaProducto({
  params,
}: {
  params: Promise<{ sku: string }>;
}) {
  const { sku } = await params;
  let p: any = null;
  try {
    const res = await apiFetch(`/productos/${encodeURIComponent(sku)}/detalle`);
    if (res.ok) p = await res.json();
  } catch {}

  if (!p) {
    return (
      <main className="min-h-screen bg-[#F0EBE2]">
        <Header activo="/productos" />
        <div className="max-w-4xl mx-auto p-6">
          <p className="rounded-lg bg-white p-4 text-sm text-[#932A1F]">
            No existe el producto {sku}. <Link href="/productos" className="underline">Volver</Link>
          </p>
        </div>
      </main>
    );
  }

  const margenPct = p.costo && p.precio ? Math.round(((p.precio - p.costo) / p.costo) * 100) : null;

  return (
    <main className="min-h-screen bg-[#F0EBE2]">
      <Header activo="/productos" />
      <div className="max-w-5xl mx-auto p-6 space-y-4">
        <Link href="/productos" className="text-xs text-black/50 hover:text-black">
          ← Volver a productos
        </Link>

        <section className="rounded-xl bg-white p-5 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-medium text-black">{p.nombre}</h1>
            <p className="text-sm text-black/50 mt-1">
              {p.sku} · {p.marca ?? 'sin marca'} · {p.categoria ?? 'sin categoría'}
              {p.esAlcohol && (
                <span className="ml-2 rounded-full bg-black px-2 py-0.5 text-[10px] text-white align-middle">+18</span>
              )}
            </p>
            {p.codigosBarras?.length > 0 && (
              <p className="text-xs text-black/40 mt-1 font-mono">{p.codigosBarras.join(' · ')}</p>
            )}
            {p.descuento && (
              <p className="mt-2 inline-block rounded-full bg-[#B82D25] px-3 py-1 text-xs font-medium text-white">
                {p.descuento}
              </p>
            )}
          </div>
          <div className="text-right">
            {p.descuento && <p className="text-sm text-black/40 line-through">{pesos(p.precioLista)}</p>}
            <p className="text-3xl font-medium text-black">{pesos(p.precio)}</p>
            <p className="text-xs text-black/50 mt-1">
              costo {pesos(p.costo)} {margenPct != null && `· margen ${margenPct} %`}
            </p>
          </div>
        </section>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="rounded-xl bg-white p-4">
            <p className="text-xs text-black/50">Vendido (30 días)</p>
            <p className="text-xl font-medium text-black">{p.ventas30dias.unidades} u.</p>
            <p className="text-xs text-black/40">{p.ventas30dias.porDia}/día</p>
          </div>
          <div className="rounded-xl bg-white p-4">
            <p className="text-xs text-black/50">Facturado (30 días)</p>
            <p className="text-xl font-medium text-black">{pesos(p.ventas30dias.facturado)}</p>
          </div>
          <div className="rounded-xl bg-white p-4">
            <p className="text-xs text-black/50">Margen (30 días)</p>
            <p className="text-xl font-medium text-black">{pesos(p.ventas30dias.margen)}</p>
          </div>
          <div className="rounded-xl bg-white p-4">
            <p className="text-xs text-black/50">Stock total</p>
            <p className="text-xl font-medium text-black">{Math.round(p.stockTotal)} u.</p>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <section className="rounded-xl bg-white overflow-hidden">
            <h2 className="px-4 py-3 border-b border-black/10 font-medium text-black text-sm">
              Stock por sucursal
            </h2>
            <table className="w-full text-sm text-black">
              <tbody>
                {p.stockPorSucursal.map((s: any, i: number) => (
                  <tr key={i} className="border-b border-black/5 last:border-0">
                    <td className="px-4 py-2.5">{s.sucursal}</td>
                    <td className="px-4 py-2.5 text-right">
                      <span
                        className={
                          Number(s.cantidad) <= Number(s.stock_minimo)
                            ? 'rounded-full bg-[#B82D25] px-2.5 py-0.5 text-xs font-medium text-white'
                            : 'font-medium'
                        }
                      >
                        {Math.round(Number(s.cantidad))} u.
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right text-xs text-black/40">
                      mín. {Math.round(Number(s.stock_minimo))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="rounded-xl bg-white overflow-hidden">
            <h2 className="px-4 py-3 border-b border-black/10 font-medium text-black text-sm">
              Proveedores
            </h2>
            <table className="w-full text-sm text-black">
              <tbody>
                {p.proveedores.map((pr: any, i: number) => (
                  <tr key={i} className="border-b border-black/5 last:border-0">
                    <td className="px-4 py-2.5">
                      <p>{pr.proveedor?.razon_social}</p>
                      <p className="text-xs text-black/40">
                        {pr.codigo_proveedor ?? 's/cód.'} · entrega {pr.proveedor?.lead_time_dias} días
                      </p>
                    </td>
                    <td className="px-4 py-2.5 text-right font-medium">{pesos(pr.ultimo_costo)}</td>
                  </tr>
                ))}
                {p.proveedores.length === 0 && (
                  <tr><td className="px-4 py-4 text-sm text-black/40">Sin proveedor asignado</td></tr>
                )}
              </tbody>
            </table>
          </section>

          <section className="rounded-xl bg-white overflow-hidden">
            <h2 className="px-4 py-3 border-b border-black/10 font-medium text-black text-sm">
              Historial de costos
            </h2>
            <table className="w-full text-sm text-black">
              <tbody>
                {p.historialCostos.map((c: any, i: number) => (
                  <tr key={i} className="border-b border-black/5 last:border-0">
                    <td className="px-4 py-2 text-xs text-black/50">{fecha(c.creado_en)}</td>
                    <td className="px-4 py-2 text-xs text-black/50">{c.proveedor?.razon_social ?? c.origen}</td>
                    <td className="px-4 py-2 text-right font-medium">{pesos(c.costo)}</td>
                  </tr>
                ))}
                {p.historialCostos.length === 0 && (
                  <tr><td className="px-4 py-4 text-sm text-black/40">Sin cambios registrados</td></tr>
                )}
              </tbody>
            </table>
          </section>

          <section className="rounded-xl bg-white overflow-hidden">
            <h2 className="px-4 py-3 border-b border-black/10 font-medium text-black text-sm">
              Últimos movimientos de stock
            </h2>
            <table className="w-full text-sm text-black">
              <tbody>
                {p.movimientos.map((m: any, i: number) => (
                  <tr key={i} className="border-b border-black/5 last:border-0">
                    <td className="px-4 py-2 text-xs text-black/50">{fecha(m.creado_en)}</td>
                    <td className="px-4 py-2 text-xs">{TIPO_MOV[m.tipo] ?? m.tipo}</td>
                    <td className="px-4 py-2 text-xs text-black/50">{m.sucursal?.nombre}</td>
                    <td
                      className={
                        'px-4 py-2 text-right font-medium ' +
                        (Number(m.cantidad) < 0 ? 'text-[#932A1F]' : '')
                      }
                    >
                      {Number(m.cantidad) > 0 ? '+' : ''}
                      {Math.round(Number(m.cantidad))}
                    </td>
                  </tr>
                ))}
                {p.movimientos.length === 0 && (
                  <tr><td className="px-4 py-4 text-sm text-black/40">Sin movimientos</td></tr>
                )}
              </tbody>
            </table>
          </section>
        </div>
      </div>
    </main>
  );
}
