import { Pantalla } from '../ui/kit/Pantalla';
import { ChatSommelier } from './ChatSommelier';

export default function Sommelier() {
  return (
    <Pantalla activo="/sommelier" ancho="angosto">
      <ChatSommelier />
    </Pantalla>
  );
}
