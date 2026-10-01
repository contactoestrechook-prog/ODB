import { Pantalla } from '../ui/kit/Pantalla';
import BotSimulador from '../ui/BotSimulador';

export const metadata = { title: 'Probar el bot · ODB' };

export default function BotPage() {
  return (
    <Pantalla activo="/bot" ancho="angosto">
      <BotSimulador />
    </Pantalla>
  );
}
