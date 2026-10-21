import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { Pantalla } from '../ui/kit/Pantalla';
import { RepartidorView } from '../ui/RepartidorView';
import { rolDesdeToken } from '../lib/permisos';

export const dynamic = 'force-dynamic';

// La pantalla del repartidor (lo único que puede abrir ese rol). El resto del
// equipo la ve como sección de Reparto › "Entregas en la calle" (21/10/2026).
export default async function Repartidor() {
  const rol = rolDesdeToken((await cookies()).get('odb_token')?.value);
  if (rol !== 'repartidor') redirect('/reparto?vista=entregas');
  return (
    <Pantalla activo="/repartidor" ancho="angosto">
      <RepartidorView />
    </Pantalla>
  );
}
