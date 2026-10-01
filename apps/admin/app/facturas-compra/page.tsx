import { cookies } from 'next/headers';
import { Pantalla } from '../ui/kit/Pantalla';
import { Aviso } from '../ui/kit';
import { apiFetch } from '../../lib/api';
import { datosDesdeToken } from '../lib/permisos';
import { FacturasCompraWorkspace } from '../ui/FacturasCompraWorkspace';

export const dynamic = 'force-dynamic';

export default async function FacturasCompra() {
  // rol y usuario del token: la pantalla muestra "Mis facturas" y decide si los
  // cambios se guardan directo (gerente/dueño) o se piden (resto)
  const yo = datosDesdeToken((await cookies()).get('odb_token')?.value);
  let resumen: any = {};
  let facturas: any = { items: [], total: 0, pagina: 1, porPagina: 50 };
  let proveedores: any[] = [];
  let error: string | null = null;
  try {
    const [rr, rf, rp] = await Promise.all([
      apiFetch('/compras/facturas/resumen'),
      apiFetch('/compras/facturas?porPagina=50'),
      apiFetch('/proveedores'),
    ]);
    if (rr.ok) resumen = await rr.json();
    if (rf.ok) facturas = await rf.json();
    if (rp.ok) proveedores = await rp.json();
    if (!rr.ok && !rf.ok) throw new Error('La API respondió con error');
  } catch (e) {
    error = e instanceof Error ? e.message : 'Error desconocido';
  }

  return (
    <Pantalla activo="/facturas-compra" ancho="ancho">
      {error ? (
        <Aviso tono="error">No pude consultar la API ({error}).</Aviso>
      ) : (
        <FacturasCompraWorkspace resumenInicial={resumen} facturasInicial={facturas} proveedores={proveedores} rol={yo.rol} usuarioId={yo.sub} />
      )}
    </Pantalla>
  );
}
