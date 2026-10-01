import { cookies } from 'next/headers';
import { Pantalla } from '../ui/kit/Pantalla';
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

export default async function MesaCompras({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  const token = (await cookies()).get('odb_token')?.value;
  const esDueno = rolDe(token) === 'dueno';
  return (
    <Pantalla activo="/mesa-compras">
      <MesaComprasWorkspace esDueno={esDueno} tabInicial={tab} />
    </Pantalla>
  );
}
