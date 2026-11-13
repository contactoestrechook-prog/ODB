import { cookies } from 'next/headers';
import { Pantalla } from '../ui/kit/Pantalla';
import { SomelierPantalla } from '../ui/Somelier';
import { sucursalDesdeToken } from '../lib/permisos';

export const dynamic = 'force-dynamic';

// Somelier ODB. 13/11/2026 («es una cagada el somelier, ¿no?»): a pantalla
// completa, con la cava entera del local arriba, el somelier a la izquierda y
// la cava filtrada y ordenada para lo que busca el cliente a la derecha.
export default async function Sommelier() {
  const sucursal = sucursalDesdeToken((await cookies()).get('odb_token')?.value);
  return (
    <Pantalla activo="/sommelier" ancho="completo">
      <SomelierPantalla sucursalUsuario={sucursal} />
    </Pantalla>
  );
}
