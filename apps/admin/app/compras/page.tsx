import { Header } from '../ui/Header';
import { apiFetch, API } from '../../lib/api';
import { ComprasWorkspace } from '../ui/ComprasWorkspace';

export const dynamic = 'force-dynamic';

export default async function Compras() {
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
    <main className="min-h-screen bg-[#F0EBE2] lg:pl-64">
      <Header activo="/compras" />
      <div className="max-w-5xl mx-auto p-6">
        {error ? (
          <p className="rounded-lg bg-white p-4 text-sm text-[#932A1F]">No pude consultar la API ({error}). ¿Está corriendo en {API}?</p>
        ) : (
          <ComprasWorkspace resumen={resumen} ordenes={ordenes} proveedores={proveedores} sugerencias={sugerencias} sucursales={sucursales} categorias={categorias} />
        )}
      </div>
    </main>
  );
}
