import { cookies } from 'next/headers';
import { Pantalla } from '../ui/kit/Pantalla';
import { CtaCteTablero } from '../ui/CtaCteTablero';
import { datosDesdeToken } from '../lib/permisos';

export const dynamic = 'force-dynamic';

export default async function CuentasCorrientes() {
  const rol = datosDesdeToken((await cookies()).get('odb_token')?.value).rol;
  return (
    <Pantalla activo="/cuentas-corrientes">
      <CtaCteTablero esDueno={rol === 'dueno'} />
    </Pantalla>
  );
}
