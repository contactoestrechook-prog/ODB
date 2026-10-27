import { Pantalla } from '../../ui/kit/Pantalla';
import { FichaProveedor } from '../../ui/FichaProveedor';

export const dynamic = 'force-dynamic';

export default async function FichaProveedorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Pantalla activo="/proveedores" sinCabecera>
      <FichaProveedor id={id} />
    </Pantalla>
  );
}
