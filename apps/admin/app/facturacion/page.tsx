import { apiFetch } from '../../lib/api';
import { FacturacionWorkspace } from '../ui/FacturacionWorkspace';
import { Pantalla } from '../ui/kit/Pantalla';

export const dynamic = 'force-dynamic';

// El tablero del mes lo pide la pantalla misma (GET /facturacion/tablero):
// así la página abre en el momento y las flechas del mes no recargan todo.
export default async function Facturacion({
  searchParams,
}: {
  searchParams: Promise<{ venta?: string; total?: string }>;
}) {
  const params = await searchParams;
  const rs = await apiFetch('/sucursales').catch(() => null);
  const sucursales = rs?.ok ? await rs.json() : [];

  return (
    <Pantalla activo="/facturacion" ancho="completo">
      <FacturacionWorkspace
        sucursales={sucursales}
        ventaInicial={params.venta ? { id: params.venta, total: Number(params.total ?? 0) } : null}
      />
    </Pantalla>
  );
}
