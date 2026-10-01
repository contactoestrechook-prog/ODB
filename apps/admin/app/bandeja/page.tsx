import { Pantalla } from '../ui/kit/Pantalla';
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
    <Pantalla activo="/bandeja">
      <div className="flex justify-end">
        <a
          href="/responde"
          className="inline-flex min-h-11 items-center rounded-full text-sm text-tinta/70 underline underline-offset-2 hover:text-tinta focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marca"
        >
          Las conversaciones están en RESPONDE →
        </a>
      </div>
      <BandejaWhatsapp puedeApagarLinea={puede} />
    </Pantalla>
  );
}
