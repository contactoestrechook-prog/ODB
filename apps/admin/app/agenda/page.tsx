import { Pantalla } from '../ui/kit/Pantalla';
import { Agenda } from '../ui/Agenda';

export const dynamic = 'force-dynamic';

export default function AgendaPagina() {
  return (
    <Pantalla activo="/agenda">
      <Agenda />
    </Pantalla>
  );
}
