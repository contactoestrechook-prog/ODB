import { Pantalla } from '../ui/kit/Pantalla';
import { ColaDeposito } from './ColaDeposito';

export default function Deposito() {
  return (
    <Pantalla activo="/deposito" ancho="ancho">
      <ColaDeposito />
    </Pantalla>
  );
}
