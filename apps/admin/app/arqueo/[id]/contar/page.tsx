import { Pantalla } from '../../../ui/kit/Pantalla';
import { ArqueoContar } from '../../../ui/ArqueoContar';

export const dynamic = 'force-dynamic';

// Contar un arqueo desde el celular (lector de mano o cámara).
export default async function ArqueoContarPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Pantalla activo="/arqueo" ancho="angosto">
      <ArqueoContar id={id} />
    </Pantalla>
  );
}
