import { Pantalla } from '../ui/kit/Pantalla';
import { TraspasosWorkspace } from '../ui/TraspasosWorkspace';

export const dynamic = 'force-dynamic';

// Traspasos entre locales (10/11/2026): pedir, mandar, recibir y diferencias.
export default function Traspasos() {
  return (
    <Pantalla activo="/traspasos" ancho="normal">
      <TraspasosWorkspace />
    </Pantalla>
  );
}
