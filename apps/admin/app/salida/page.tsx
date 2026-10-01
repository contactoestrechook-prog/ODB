import { Pantalla } from '../ui/kit/Pantalla';
import { ControlSalida } from './ControlSalida';

export default function Salida() {
  return (
    <Pantalla activo="/salida" ancho="angosto">
      <ControlSalida />
    </Pantalla>
  );
}
