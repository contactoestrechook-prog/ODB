import { cookies } from 'next/headers';
import { Header } from '../ui/Header';
import { ReportesWorkspace } from '../ui/ReportesWorkspace';
import { rolDesdeToken } from '../lib/permisos';

export const dynamic = 'force-dynamic';

// Lo que el equipo marcó como "Esto está mal", clasificado por la IA.
export default async function ReportesPage() {
  const rol = rolDesdeToken((await cookies()).get('odb_token')?.value);
  return (
    <main className="min-h-screen bg-[#F0EBE2] lg:pl-64">
      <Header activo="/reportes" />
      <ReportesWorkspace puedeResolver={rol === 'dueno'} />
    </main>
  );
}
