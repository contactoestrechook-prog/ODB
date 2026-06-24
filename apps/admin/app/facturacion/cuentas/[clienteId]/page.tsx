import Link from 'next/link';
import { Header } from '../../../ui/Header';
import { apiFetch } from '../../../../lib/api';
import { RegistrarCobranza } from '../../../ui/RegistrarCobranza';

const pesos = (n: number) => '$' + Math.round(n).toLocaleString('es-AR');

export const dynamic = 'force-dynamic';

export default async function CuentaCliente({ params }: { params: Promise<{ clienteId: string }> }) {
  const { clienteId } = await params;
  const res = await apiFetch(`/facturacion/cuentas/${clienteId}`);
  if (!res.ok) {
    return (
      <main className="min-h-screen bg-[#F0EBE2] lg:pl-64">
        <Header activo="/facturacion" />
        <p className="max-w-3xl mx-auto p-6 text-sm text-[#932A1F]">No existe la cuenta.</p>
      </main>
    );
  }
  const { cliente, saldo, movimientos } = await res.json();

  // saldo corrido de atrás hacia adelante
  let acumulado = saldo;
  const filas = (movimientos as any[]).map((m) => {
    const fila = { ...m, saldo: acumulado };
    acumulado -= Number(m.debe) - Number(m.haber);
    return fila;
  });

  return (
    <main className="min-h-screen bg-[#F0EBE2] lg:pl-64">
      <Header activo="/facturacion" />
      <div className="max-w-4xl mx-auto p-6 space-y-5">
        <Link href="/facturacion/cuentas" className="text-xs text-black/50 hover:text-black">← Todas las cuentas</Link>

        <section className="rounded-xl bg-white p-5 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold text-black">{cliente.razon_social ?? cliente.nombre}</h1>
            <p className="text-xs text-black/45 mt-0.5">
              {cliente.cuit ?? cliente.dni} · {(cliente.condicion_iva ?? '').replaceAll('_', ' ')}
              {cliente.telefono && ` · ${cliente.telefono}`}
            </p>
          </div>
          <div className="flex items-center gap-5">
            <div className="text-right">
              <p className={`text-2xl font-semibold leading-none ${saldo > 0 ? 'text-[#B82D25]' : 'text-emerald-700'}`}>
                {saldo > 0 ? pesos(saldo) : saldo < 0 ? `${pesos(-saldo)} a favor` : 'Al día'}
              </p>
              {saldo > 0 && <p className="text-xs text-black/45 mt-1">saldo deudor</p>}
            </div>
            <RegistrarCobranza clienteId={clienteId} nombre={cliente.razon_social ?? cliente.nombre} saldo={saldo} />
          </div>
        </section>

        <section className="rounded-xl bg-white overflow-hidden">
          <table className="w-full text-sm text-black">
            <thead>
              <tr className="border-b border-black/10 text-left text-xs text-black/50">
                <th className="px-4 py-3 font-medium">Fecha</th>
                <th className="px-4 py-3 font-medium">Concepto</th>
                <th className="px-4 py-3 font-medium text-right">Debe</th>
                <th className="px-4 py-3 font-medium text-right">Haber</th>
                <th className="px-4 py-3 font-medium text-right">Saldo</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((m: any, i: number) => (
                <tr key={i} className="border-b border-black/5 last:border-0">
                  <td className="px-4 py-2.5 text-xs text-black/50 whitespace-nowrap">
                    {new Date(m.creado_en).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' })}
                  </td>
                  <td className="px-4 py-2.5 text-xs">{m.concepto}</td>
                  <td className="px-4 py-2.5 text-right">{Number(m.debe) > 0 ? pesos(m.debe) : ''}</td>
                  <td className="px-4 py-2.5 text-right text-emerald-700">{Number(m.haber) > 0 ? pesos(m.haber) : ''}</td>
                  <td className={`px-4 py-2.5 text-right font-medium ${m.saldo > 0 ? 'text-[#B82D25]' : 'text-black'}`}>
                    {pesos(m.saldo)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </main>
  );
}
