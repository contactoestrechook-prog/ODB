import { Pantalla } from '../ui/kit/Pantalla';
import { PuertaTraseraAdmin } from '../ui/PuertaTraseraAdmin';

export const dynamic = 'force-dynamic';

// Lo que el salón recibió con remito espera la factura (5/11/2026)
export default function PuertaTrasera() {
  return (
    <Pantalla activo="/puerta-trasera">
      <PuertaTraseraAdmin />
    </Pantalla>
  );
}
