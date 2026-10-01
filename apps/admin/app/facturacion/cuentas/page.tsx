import Link from 'next/link';
import { apiFetch } from '../../../lib/api';
import { BotonVolver } from '../../ui/BotonVolver';
import { FOCO_ADENTRO, Kpi, Monto, Tarjeta, TarjetaCabecera, Vacio, unir } from '../../ui/kit';
import { Pantalla } from '../../ui/kit/Pantalla';
import { pesos } from '../../lib/formato';

export const dynamic = 'force-dynamic';

export default async function Cuentas() {
  const res = await apiFetch('/facturacion/cuentas');
  const cuentas: any[] = res.ok ? await res.json() : [];
  const porCobrar = cuentas.reduce((s, c) => s + Math.max(c.saldo, 0), 0);

  return (
    <Pantalla activo="/facturacion">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <BotonVolver href="/facturacion" label="Volver a facturación" />
        <Kpi etiqueta="Total por cobrar" valor={<Monto valor={porCobrar} />} tono="atencion" className="w-full sm:w-auto sm:min-w-56" />
      </div>

      <Tarjeta relleno={false} className="overflow-hidden">
        <TarjetaCabecera titulo={`Cuentas corrientes (${cuentas.length})`} />
        {cuentas.length === 0 && <Vacio className="m-4" titulo="Sin movimientos de cuenta corriente todavía." />}
        <ul className="divide-y divide-black/[0.06]">
          {cuentas.map((c) => (
            <li key={c.cliente?.id}>
              <Link
                href={`/facturacion/cuentas/${c.cliente?.id}`}
                className={unir('flex min-h-11 items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-crema-claro sm:px-5', FOCO_ADENTRO)}
              >
                <div className="min-w-0 text-sm text-tinta">
                  <p className="break-words font-medium">{c.cliente?.razon_social ?? c.cliente?.nombre ?? '—'}</p>
                  <p className="text-xs text-tinta/60">{c.cliente?.dni} {c.cliente?.telefono && `· ${c.cliente.telefono}`}</p>
                </div>
                <p className={unir('importe shrink-0 text-sm font-semibold', c.saldo > 0 ? 'text-marca-hondo' : 'text-ok')}>
                  {c.saldo > 0 ? `debe ${pesos(c.saldo)}` : c.saldo < 0 ? `a favor ${pesos(-c.saldo)}` : 'al día'}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      </Tarjeta>
    </Pantalla>
  );
}
