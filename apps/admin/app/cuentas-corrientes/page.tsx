import { cookies } from 'next/headers';
import { Pantalla } from '../ui/kit/Pantalla';
import { CtaCteTablero } from '../ui/CtaCteTablero';
import { datosDesdeToken } from '../lib/permisos';

export const dynamic = 'force-dynamic';

export default async function CuentasCorrientes({ searchParams }: { searchParams: Promise<{ tipo?: string }> }) {
  const rol = datosDesdeToken((await cookies()).get('odb_token')?.value).rol;
  // menú › Clientes › Sponsors WF: las cuentas de los sponsors del Wine Fest (24/10/2026)
  const tipo = (await searchParams).tipo === 'sponsor' ? 'sponsor' : 'cliente';
  return (
    <Pantalla activo={tipo === 'sponsor' ? '/cuentas-corrientes?tipo=sponsor' : '/cuentas-corrientes'}>
      <CtaCteTablero esDueno={rol === 'dueno'} tipo={tipo} />
    </Pantalla>
  );
}
