import { cookies } from 'next/headers';
import { Pantalla } from '../ui/kit/Pantalla';
import { Manual } from '../ui/Manual';
import { rolDesdeToken } from '../lib/permisos';
import { GRUPOS } from '../ui/Header';
import { apiFetch } from '../../lib/api';
import type { Novedad } from '../ui/ManualAsistente';

export const dynamic = 'force-dynamic';

// El manual lo puede abrir cualquiera que entre al sistema: es la explicación
// de cómo se trabaja acá, no información reservada. Lo que cambia según el rol
// es el orden — arriba va lo del área de quien lo abre.
export default async function ManualPage() {
  const rol = rolDesdeToken((await cookies()).get('odb_token')?.value);
  // lo nuevo sale solo de cada publicación; sin la API, el manual anda igual
  let novedades: Novedad[] = [];
  try {
    const r = await apiFetch('/manual/novedades');
    if (r.ok) novedades = await r.json();
  } catch {
    // sin novedades
  }
  const pantallas = Object.fromEntries(GRUPOS.flatMap((g) => g.items.map((i) => [i.href, i.label])));
  return (
    <Pantalla activo="/manual" ancho="angosto">
      <Manual rol={rol} pantallas={pantallas} novedades={novedades} />
    </Pantalla>
  );
}
