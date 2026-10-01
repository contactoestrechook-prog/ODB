import { Suspense } from 'react';
import { Pantalla } from '../../ui/kit/Pantalla';
import { Aviso, Cargando } from '../../ui/kit';
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
  let proveedores: { id: string; razon_social: string }[] = [];
  let error: string | null = null;
  try {
    const [rf, rs, rp] = await Promise.all([apiFetch('/catalogo/filtros'), apiFetch('/sucursales'), apiFetch('/proveedores')]);
    if (rf.ok) {
      const f = await rf.json();
      rubros = (f.categorias ?? []).map((c: any) => ({ id: c.id, nombre: c.nombre, margenSugerido: c.margen_sugerido }));
      marcas = f.marcas ?? [];
    }
    if (rs.ok) sucursales = await rs.json();
    if (rp.ok) proveedores = await rp.json();
  } catch (e) {
    error = e instanceof Error ? e.message : 'Error desconocido';
  }

  return (
    // bajada vacía: la explicación del alta ya va arriba del formulario
    <Pantalla activo="/productos" ancho="angosto" titulo="Nuevo producto" bajada="">
      {error ? (
        <Aviso tono="error">No pude consultar la API ({error}).</Aviso>
      ) : (
        <Suspense fallback={<Cargando bloque />}>
          <AltaProducto rubros={rubros} marcas={marcas} sucursales={sucursales} proveedores={proveedores} />
        </Suspense>
      )}
    </Pantalla>
  );
}
