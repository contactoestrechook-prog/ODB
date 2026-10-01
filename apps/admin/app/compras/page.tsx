import { Pantalla } from '../ui/kit/Pantalla';
import { Aviso } from '../ui/kit';
import { apiFetch, API } from '../../lib/api';
import { ComprasWorkspace } from '../ui/ComprasWorkspace';

export const dynamic = 'force-dynamic';

export default async function Compras({ searchParams }: { searchParams: Promise<{ proveedor?: string }> }) {
  const { proveedor: abrirProveedor } = await searchParams;
  let resumen: any = {};
  let ordenes: any[] = [];
  let proveedores: any[] = [];
  let sugerencias: any[] = [];
  let sucursales: { id: string; nombre: string }[] = [];
  let categorias: { id: string; nombre: string }[] = [];
  let error: string | null = null;
  try {
    const [rr, ro, rp, rs, rsuc, rcat] = await Promise.all([
      apiFetch('/compras/resumen'),
      apiFetch('/compras/ordenes'),
      apiFetch('/proveedores'),
      apiFetch('/compras/sugerencias'),
      apiFetch('/sucursales'),
      apiFetch('/catalogo/filtros'),
    ]);
    if (rr.ok) resumen = await rr.json();
    if (ro.ok) ordenes = await ro.json();
    if (rp.ok) proveedores = await rp.json();
    if (rs.ok) sugerencias = await rs.json();
    if (rsuc.ok) sucursales = await rsuc.json();
    if (rcat.ok) categorias = (await rcat.json()).categorias ?? [];
    if (!ro.ok && !rp.ok) throw new Error('La API respondió con error');
  } catch (e) {
    error = e instanceof Error ? e.message : 'Error desconocido';
  }

  return (
    <Pantalla activo="/compras" ancho="ancho">
      {error ? (
        <Aviso tono="error">No pude consultar la API ({error}). ¿Está corriendo en {API}?</Aviso>
      ) : (
        <ComprasWorkspace resumen={resumen} ordenes={ordenes} proveedores={proveedores} sugerencias={sugerencias} sucursales={sucursales} categorias={categorias} abrirProveedor={abrirProveedor} />
      )}
    </Pantalla>
  );
}
