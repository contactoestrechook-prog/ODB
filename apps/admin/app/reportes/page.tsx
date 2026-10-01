import { cookies } from 'next/headers';
import { ReportesWorkspace } from '../ui/ReportesWorkspace';
import { rolDesdeToken } from '../lib/permisos';
import { Pantalla } from '../ui/kit/Pantalla';

export const dynamic = 'force-dynamic';

// Lo que el equipo marcó como "Esto está mal", clasificado por la IA.
export default async function ReportesPage() {
  const rol = rolDesdeToken((await cookies()).get('odb_token')?.value);
  return (
    <Pantalla activo="/reportes">
      <ReportesWorkspace puedeResolver={rol === 'dueno'} />
    </Pantalla>
  );
}
