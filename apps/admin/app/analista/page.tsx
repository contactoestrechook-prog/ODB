import { Pantalla } from '../ui/kit/Pantalla';
import { ChatAnalista } from './ChatAnalista';

export default function Analista() {
  return (
    <Pantalla activo="/analista" ancho="angosto">
      <ChatAnalista />
    </Pantalla>
  );
}
