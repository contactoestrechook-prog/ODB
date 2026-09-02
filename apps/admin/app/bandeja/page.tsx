import { Header } from '../ui/Header';
import { BandejaWhatsapp } from '../ui/BandejaWhatsapp';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { datosDesdeToken } from '../lib/permisos';

// La bandeja de WhatsApp del sistema: charlas en vivo, mensajes programados y
// DIFUSIONES (las campañas salen de acá). Con menú y vuelta atrás — la app
// embebida de RESPONDE (/whatsapp) es pantalla completa y no tiene salida.
export const dynamic = 'force-dynamic';

export default async function PaginaBandeja() {
  const yo = datosDesdeToken((await cookies()).get('odb_token')?.value);
  if (!yo.sub) redirect('/login');
  const puede = yo.rol === 'dueno' || yo.rol === 'gerente';
  return (
    <main className="min-h-screen bg-[#F0EBE2] lg:pl-64">
      <Header activo="/bandeja" />
      <div className="max-w-5xl mx-auto p-4">
        <div className="bg-white rounded-xl border border-neutral-200 overflow-hidden flex flex-col" style={{ height: 'calc(100vh - 3rem)' }}>
          <BandejaWhatsapp puedeApagarLinea={puede} />
        </div>
      </div>
    </main>
  );
}
