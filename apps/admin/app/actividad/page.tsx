import { Pantalla } from '../ui/kit/Pantalla';
import { ActividadWorkspace } from '../ui/ActividadWorkspace';

export const dynamic = 'force-dynamic';

// Quién hizo qué (6/10/2026): la pantalla lee /api/actividad en el navegador,
// así cambiar de filtro no recarga toda la página.
export default function Actividad() {
  return (
    <Pantalla activo="/actividad" ancho="normal">
      <ActividadWorkspace />
    </Pantalla>
  );
}
