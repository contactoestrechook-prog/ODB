import { Pantalla } from '../ui/kit/Pantalla';
import { Aviso } from '../ui/kit';
import { apiFetch, API } from '../../lib/api';
import { StockWorkspace } from '../ui/StockWorkspace';

export const dynamic = 'force-dynamic';

export default async function Stock() {
  let resumen: any = {};
  let valorizacion: any = { rubros: [], sucursales: [] };
  let criticos: any[] = [];
  let vencimientos: any = null;
  let transferencias: any[] = [];
  let sucursales: { id: string; nombre: string }[] = [];
  let error: string | null = null;
  try {
    const [rr, rv, rc, rven, rt, rs] = await Promise.all([
      apiFetch('/stock/resumen'),
      apiFetch('/stock/valorizacion'),
      apiFetch('/stock/bajo-minimo'),
      apiFetch('/vencimientos'),
      apiFetch('/stock/transferencias'),
      apiFetch('/sucursales'),
    ]);
    if (rr.ok) resumen = await rr.json();
    if (rv.ok) valorizacion = await rv.json();
    if (rc.ok) criticos = await rc.json();
    if (rven.ok) vencimientos = await rven.json();
    if (rt.ok) transferencias = await rt.json();
    if (rs.ok) sucursales = await rs.json();
    if (!rr.ok && !rc.ok) throw new Error('La API respondió con error');
  } catch (e) {
    error = e instanceof Error ? e.message : 'Error desconocido';
  }

  return (
    <Pantalla activo="/stock" ancho="ancho">
      {error ? (
        <Aviso tono="error">
          No pude consultar la API ({error}). ¿Está corriendo en {API}?
        </Aviso>
      ) : (
        <StockWorkspace
          resumen={resumen}
          valorizacion={valorizacion}
          criticos={criticos}
          vencimientos={vencimientos}
          sucursales={sucursales}
          transferencias={transferencias}
        />
      )}
    </Pantalla>
  );
}
