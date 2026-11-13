import { Pantalla } from '../ui/kit/Pantalla';
import { BotonLink } from '../ui/kit';
import { apiFetch } from '../../lib/api';
import { InventarioPantalla } from '../ui/InventarioEntrada';
import type { FichaInventario } from '../lib/inventario';

export const dynamic = 'force-dynamic';

// Inventario de producto. 5/11/2026: se busca un producto y se abre su ficha
// con cuánto hay, cómo se movió, cuánto se vende y a cuánto se compra.
// 13/11/2026: a pantalla completa, con cómo está el stock entero arriba, las
// listas para recorrer a la izquierda y la ficha abierta a la derecha. La ficha
// va en la dirección (?sku=L341) para poder mandarla o volver con «atrás».
export default async function Inventario({ searchParams }: { searchParams: Promise<{ sku?: string; volver?: string }> }) {
  const sp = await searchParams;
  const sku = (sp.sku ?? '').trim();
  // desde la lista de Stock se llega con ?volver=/stock?… para volver con los filtros intactos
  const volver = sp.volver?.startsWith('/stock') ? sp.volver : null;
  let ficha: FichaInventario | null = null;
  let error: string | null = null;
  if (sku) {
    try {
      const r = await apiFetch(`/inventario/producto/${encodeURIComponent(sku)}`);
      if (r.ok) ficha = await r.json();
      else error = r.status === 404 ? `No existe el producto ${sku}.` : 'No pude traer el inventario de ese producto. Probá de nuevo.';
    } catch {
      error = 'No pude consultar la API. Probá de nuevo en un momento.';
    }
  }

  return (
    <Pantalla activo="/inventario" ancho="completo">
      {volver && <BotonLink href={volver} variante="secundario" tamano="chico" className="w-fit">Volver al stock</BotonLink>}
      {/* cada ficha abierta desde el celular es otra página: la pantalla arranca de nuevo */}
      <InventarioPantalla key={ficha?.producto.sku ?? 'entrada'} fichaInicial={ficha} error={error} />
    </Pantalla>
  );
}
