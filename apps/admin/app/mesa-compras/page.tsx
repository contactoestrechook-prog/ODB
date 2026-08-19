import { cookies } from 'next/headers';
import { Header } from '../ui/Header';
import { MesaComprasWorkspace } from '../ui/MesaComprasWorkspace';

export const dynamic = 'force-dynamic';

// El rol sale del token de sesión: el botón de aprobar solo se muestra al dueño
// (la API lo vuelve a exigir igual, esto es solo para no mostrar lo que no puede tocar).
function rolDe(token?: string): string {
  if (!token) return '';
  try {
    return JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString()).rol ?? '';
  } catch {
    return '';
  }
}

export default async function MesaCompras() {
  const token = (await cookies()).get('odb_token')?.value;
  const esDueno = rolDe(token) === 'dueno';
  return (
    <main className="min-h-screen bg-[#F0EBE2] lg:pl-64">
      <Header activo="/mesa-compras" />
      <div className="max-w-4xl mx-auto p-6">
        <MesaComprasWorkspace esDueno={esDueno} />
      </div>
    </main>
  );
}
