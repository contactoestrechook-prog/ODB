import { Pantalla } from '../ui/kit/Pantalla';
import { ProveedoresLista } from '../ui/ProveedoresLista';

export const dynamic = 'force-dynamic';

// Proveedores: la ficha de cada uno para que administración los cargue
// completos (27/10/2026).
export default function ProveedoresPage() {
  return (
    <Pantalla activo="/proveedores" ancho="ancho">
      <ProveedoresLista />
    </Pantalla>
  );
}
