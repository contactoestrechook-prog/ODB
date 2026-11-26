import { Pantalla } from '../ui/kit/Pantalla';
import { MantenimientoPantalla } from '../ui/MantenimientoMetoGroup';

export const dynamic = 'force-dynamic';

// Mantenimiento (9/11/2026): lo que MetoGroup hizo en el sistema mes a mes.
// 26/11/2026: arriba, «Hablar con MetoGroup» (la charla con el agente, como en Car Cash).
export default function Mantenimiento() {
  return (
    <Pantalla activo="/mantenimiento" ancho="ancho">
      <MantenimientoPantalla />
    </Pantalla>
  );
}
