import { Pantalla } from '../ui/kit/Pantalla';
import { Aviso } from '../ui/kit';
import { apiFetch } from '../../lib/api';
import { InventarioBuscador, InventarioFicha } from '../ui/Inventario';
import type { FichaInventario, ResultadoInventario } from '../lib/inventario';

export const dynamic = 'force-dynamic';

// Inventario de producto (5/11/2026): se busca un producto y se abre su ficha
// con cuánto hay, cómo se movió, cuánto se vende y a cuánto se compra. La ficha
// va en la dirección (?sku=L341) para poder mandarla o volver con «atrás».
export default async function Inventario({ searchParams }: { searchParams: Promise<{ sku?: string }> }) {
  const sku = ((await searchParams).sku ?? '').trim();
  let ficha: FichaInventario | null = null;
  let sugeridos: ResultadoInventario[] = [];
  let error: string | null = null;
  if (!sku) {
    // la entrada: los que más se venden, para abrirlos con un toque
    try {
      const r = await apiFetch('/inventario/mas-vendidos');
      if (r.ok) sugeridos = await r.json();
    } catch {
      // sin la lista, el buscador anda igual
    }
  }
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
    <Pantalla activo="/inventario" ancho="ancho">
      <InventarioBuscador abierto={ficha ? { sku: ficha.producto.sku, nombre: ficha.producto.nombre } : null} sugeridos={sugeridos} />
      {error && <Aviso tono="error">{error}</Aviso>}
      {ficha && <InventarioFicha key={ficha.producto.sku} ficha={ficha} />}
    </Pantalla>
  );
}
