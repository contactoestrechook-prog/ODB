import { cookies } from 'next/headers';
import { Header } from '../ui/Header';
import { Manual } from '../ui/Manual';
import { rolDesdeToken } from '../lib/permisos';

export const dynamic = 'force-dynamic';

// El manual lo puede abrir cualquiera que entre al sistema: es la explicación
// de cómo se trabaja acá, no información reservada. Lo que cambia según el rol
// es el orden — arriba va lo del área de quien lo abre.
export default async function ManualPage() {
  const rol = rolDesdeToken((await cookies()).get('odb_token')?.value);
  return (
    <main className="min-h-screen bg-[#F0EBE2] lg:pl-64">
      <Header activo="/manual" />
      <Manual rol={rol} />
    </main>
  );
}
