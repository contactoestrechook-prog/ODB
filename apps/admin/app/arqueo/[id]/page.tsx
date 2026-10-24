import { cookies } from 'next/headers';
import { Pantalla } from '../../ui/kit/Pantalla';
import { ArqueoRevision } from '../../ui/ArqueoRevision';
import { rolDesdeToken } from '../../lib/permisos';

export const dynamic = 'force-dynamic';

// Revisión de un arqueo (gerencia): diferencias, reconteos y aplicar.
export default async function ArqueoRevisionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const rol = rolDesdeToken((await cookies()).get('odb_token')?.value);
  return (
    <Pantalla activo="/arqueo" ancho="ancho">
      <ArqueoRevision id={id} puedeAplicarSolo={rol === 'gerente' || rol === 'dueno'} />
    </Pantalla>
  );
}
