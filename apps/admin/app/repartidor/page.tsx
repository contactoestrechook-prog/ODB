import { Pantalla } from '../ui/kit/Pantalla';
import { RepartidorView } from '../ui/RepartidorView';

export const dynamic = 'force-dynamic';

export default function Repartidor() {
  return (
    <Pantalla activo="/repartidor" ancho="angosto">
      <RepartidorView />
    </Pantalla>
  );
}
