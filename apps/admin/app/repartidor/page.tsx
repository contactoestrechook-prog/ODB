import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { Pantalla } from '../ui/kit/Pantalla';
import { RepartidorView } from '../ui/RepartidorView';
import { puedeVer, rolDesdeToken } from '../lib/permisos';

export const dynamic = 'force-dynamic';

// La pantalla del repartidor (lo único que puede abrir ese rol). Quien abre
// Reparto la ve como sección «Mis entregas» (21/10/2026); caja y
// depósito, que no abren Reparto, la ven acá cuando llevan un envío.
export default async function Repartidor() {
  const rol = rolDesdeToken((await cookies()).get('odb_token')?.value);
  if (puedeVer(rol, '/reparto')) redirect('/reparto?vista=entregas');
  return (
    <Pantalla activo="/repartidor" ancho="angosto">
      <RepartidorView />
    </Pantalla>
  );
}
