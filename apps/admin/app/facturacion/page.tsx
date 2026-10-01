import { apiFetch } from '../../lib/api';
import { FacturacionWorkspace } from '../ui/FacturacionWorkspace';
import { Pantalla } from '../ui/kit/Pantalla';

export const dynamic = 'force-dynamic';

export default async function Facturacion({
  searchParams,
}: {
  searchParams: Promise<{ venta?: string; total?: string }>;
}) {
  const params = await searchParams;
  const [rr, rc, rs] = await Promise.all([
    apiFetch('/facturacion/resumen'),
    apiFetch('/facturacion/cuentas'),
    apiFetch('/sucursales'),
  ]);
  const resumen = rr.ok ? await rr.json() : { grupos: {}, facturadoHoy: 0, ivaMes: 0, porCobrar: 0, cuentasActivas: 0 };
  const cuentas = rc.ok ? await rc.json() : [];
  const sucursales = rs.ok ? await rs.json() : [];

  return (
    <Pantalla activo="/facturacion" ancho="ancho">
      <FacturacionWorkspace
        resumen={resumen}
        cuentas={cuentas}
        sucursales={sucursales}
        ventaInicial={params.venta ? { id: params.venta, total: Number(params.total ?? 0) } : null}
      />
    </Pantalla>
  );
}
