import { Suspense } from 'react';
import { Header } from '../../ui/Header';
import { apiFetch } from '../../../lib/api';
import { AltaProducto } from '../../ui/AltaProducto';

export const dynamic = 'force-dynamic';

// Alta de producto en página propia (antes era un modal chico dentro del
// listado). Backoffice la usa a diario cuando entra mercadería de un artículo
// que todavía no está en el catálogo, así que tiene que entrar todo de una.
export default async function NuevoProducto() {
  let rubros: { id: string; nombre: string; margenSugerido?: number | null }[] = [];
  let marcas: { id: string; nombre: string }[] = [];
  let sucursales: { id: string; nombre: string }[] = [];
  let error: string | null = null;
  try {
    const [rf, rs] = await Promise.all([apiFetch('/catalogo/filtros'), apiFetch('/sucursales')]);
    if (rf.ok) {
      const f = await rf.json();
      rubros = (f.categorias ?? []).map((c: any) => ({ id: c.id, nombre: c.nombre, margenSugerido: c.margen_sugerido }));
      marcas = f.marcas ?? [];
    }
    if (rs.ok) sucursales = await rs.json();
  } catch (e) {
    error = e instanceof Error ? e.message : 'Error desconocido';
  }

  return (
    <main className="min-h-screen bg-[#F0EBE2] lg:pl-64">
      <Header activo="/productos" />
      {error ? (
        <p className="max-w-3xl mx-auto m-6 rounded-lg bg-white p-4 text-sm text-[#932A1F]">
          No pude consultar la API ({error}).
        </p>
      ) : (
        <Suspense fallback={<p className="max-w-3xl mx-auto p-6 text-sm text-black/40">Cargando…</p>}>
          <AltaProducto rubros={rubros} marcas={marcas} sucursales={sucursales} />
        </Suspense>
      )}
    </main>
  );
}
