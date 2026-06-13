import Link from 'next/link';
import { Header } from '../../ui/Header';
import { apiFetch } from '../../../lib/api';

const pesos = (n: number) => '$' + Math.round(n).toLocaleString('es-AR');

export const dynamic = 'force-dynamic';

export default async function Cuentas() {
  const res = await apiFetch('/facturacion/cuentas');
  const cuentas: any[] = res.ok ? await res.json() : [];
  const porCobrar = cuentas.reduce((s, c) => s + Math.max(c.saldo, 0), 0);

  return (
    <main className="min-h-screen bg-[#F0EBE2] lg:pl-64">
      <Header activo="/facturacion" />
      <div className="max-w-4xl mx-auto p-6 space-y-5">
        <div className="flex items-end justify-between">
          <Link href="/facturacion" className="text-xs text-black/50 hover:text-black">← Volver a facturación</Link>
          <div className="text-right">
            <p className="text-2xl font-semibold text-[#B82D25] leading-none">{pesos(porCobrar)}</p>
            <p className="text-xs text-black/45 mt-1">total por cobrar</p>
          </div>
        </div>

        <section className="rounded-xl bg-white overflow-hidden">
          <h2 className="px-4 py-3 border-b border-black/10 font-medium text-black text-sm">
            Cuentas corrientes ({cuentas.length})
          </h2>
          {cuentas.length === 0 && (
            <p className="px-4 py-10 text-center text-black/40 text-sm">
              Sin movimientos de cuenta corriente todavía.
            </p>
          )}
          {cuentas.map((c) => (
            <Link
              key={c.cliente?.id}
              href={`/facturacion/cuentas/${c.cliente?.id}`}
              className="px-4 py-3 border-b border-black/5 last:border-0 flex items-center justify-between hover:bg-[#F0EBE2]/40"
            >
              <div className="text-sm text-black">
                <p className="font-medium">{c.cliente?.razon_social ?? c.cliente?.nombre ?? '—'}</p>
                <p className="text-xs text-black/45">{c.cliente?.dni} {c.cliente?.telefono && `· ${c.cliente.telefono}`}</p>
              </div>
              <p className={`font-semibold ${c.saldo > 0 ? 'text-[#B82D25]' : 'text-emerald-700'}`}>
                {c.saldo > 0 ? `debe ${pesos(c.saldo)}` : c.saldo < 0 ? `a favor ${pesos(-c.saldo)}` : 'al día'}
              </p>
            </Link>
          ))}
        </section>
      </div>
    </main>
  );
}
