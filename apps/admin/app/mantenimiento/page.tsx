import { Pantalla } from '../ui/kit/Pantalla';
import { MantenimientoTablero } from '../ui/MantenimientoTablero';

export const dynamic = 'force-dynamic';

// Mantenimiento (9/11/2026): lo que MetoGroup hizo en el sistema mes a mes.
export default function Mantenimiento() {
  return (
    <Pantalla activo="/mantenimiento" ancho="ancho">
      <MantenimientoTablero />
    </Pantalla>
  );
}
