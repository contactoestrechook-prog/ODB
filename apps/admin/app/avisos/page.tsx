import { cookies } from 'next/headers';
import { Pantalla } from '../ui/kit/Pantalla';
import { AvisosCelular } from '../ui/AvisosCelular';
import { rolDesdeToken } from '../lib/permisos';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Avisos en el celular · ODB' };

// Cada uno activa acá los avisos al celular en su aparato (6/11/2026).
export default async function AvisosPage() {
  const rol = rolDesdeToken((await cookies()).get('odb_token')?.value);
  return (
    <Pantalla activo="/avisos" ancho="angosto">
      <AvisosCelular rol={rol} />
    </Pantalla>
  );
}
