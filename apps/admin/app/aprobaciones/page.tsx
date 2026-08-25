import { cookies } from 'next/headers';
import { Header } from '../ui/Header';
import { Aprobaciones } from '../ui/Aprobaciones';
import { rolDesdeToken } from '../lib/permisos';

export const dynamic = 'force-dynamic';

// Todo lo que espera la firma del dueño, junto. Gerencia puede mirar la cola;
// firmar, solo el dueño (el API lo vuelve a controlar en cada llamada).
export default async function AprobacionesPage() {
  const rol = rolDesdeToken((await cookies()).get('odb_token')?.value);
  return (
    <main className="min-h-screen bg-[#F0EBE2] lg:pl-64">
      <Header activo="/aprobaciones" />
      <Aprobaciones puedeFirmar={rol === 'dueno'} />
    </main>
  );
}
