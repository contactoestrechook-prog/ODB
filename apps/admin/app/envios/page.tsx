import { Pantalla } from '../ui/kit/Pantalla';
import { EnviosWorkspace } from '../ui/EnviosWorkspace';

export const dynamic = 'force-dynamic';

export default function Envios() {
  return (
    <Pantalla activo="/envios">
      <EnviosWorkspace />
    </Pantalla>
  );
}
