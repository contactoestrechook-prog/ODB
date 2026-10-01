import { Pantalla } from '../ui/kit/Pantalla';
import { Fraccionar } from './Fraccionar';

export default function PaginaFraccionar() {
  return (
    <Pantalla activo="/fraccionar">
      <Fraccionar />
    </Pantalla>
  );
}
