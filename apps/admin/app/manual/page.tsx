import { cookies } from 'next/headers';
import { Pantalla } from '../ui/kit/Pantalla';
import { Manual } from '../ui/Manual';
import { rolDesdeToken } from '../lib/permisos';

export const dynamic = 'force-dynamic';

// El manual lo puede abrir cualquiera que entre al sistema: es la explicación
// de cómo se trabaja acá, no información reservada. Lo que cambia según el rol
// es el orden — arriba va lo del área de quien lo abre.
export default async function ManualPage() {
  const rol = rolDesdeToken((await cookies()).get('odb_token')?.value);
  return (
    <Pantalla activo="/manual" ancho="angosto">
      <Manual rol={rol} />
    </Pantalla>
  );
}
