import { cookies } from 'next/headers';
import { Pantalla } from '../ui/kit/Pantalla';
import { Manual, type GrupoManual } from '../ui/Manual';
import { datosDesdeToken, puedeVer, rolesDesdeToken } from '../lib/permisos';
import { GRUPOS, TITULOS } from '../ui/Header';
import { apiFetch } from '../../lib/api';
import type { Novedad } from '../ui/ManualAsistente';

export const dynamic = 'force-dynamic';

// El manual lo puede abrir cualquiera que entre al sistema: es la explicación
// de cómo se trabaja acá, no información reservada. Lo que cambia según el rol
// es el orden — arriba va lo del área de quien lo abre.
//
// MODO DUEÑO (Leandro, 26/11/2026: «necesitamos un manual súper intuitivo para
// el modo dueño de cómo usar todo el sistema 100% actualizado; puede ser con
// preguntas, con inteligencia artificial que pueda preguntarle todo»): el dueño
// entra a «Manual del dueño», con la pregunta arriba, su día y el sistema
// entero pantalla por pantalla, armado con el mismo menú que ve.
export default async function ManualPage() {
  const token = (await cookies()).get('odb_token')?.value;
  const sesion = datosDesdeToken(token);
  const roles = rolesDesdeToken(token);
  const esDueno = roles.includes('dueno');

  // lo nuevo sale solo de cada publicación; la Caja del dueño, solo con su permiso.
  // Sin la API, el manual anda igual.
  const [novedades, cajaDueno] = await Promise.all([
    (async (): Promise<Novedad[]> => {
      try {
        const r = await apiFetch('/manual/novedades');
        return r.ok ? await r.json() : [];
      } catch { return []; }
    })(),
    (async () => {
      if (!esDueno) return false;
      try {
        const r = await apiFetch('/caja-dueno/permiso');
        return r.ok ? !!(await r.json())?.puede : false;
      } catch { return false; }
    })(),
  ]);

  // el menú tal como lo ve quien entró (mismo filtro que Header)
  const permisosPropios = cajaDueno ? ['caja_dueno'] : [];
  const grupos: GrupoManual[] = GRUPOS.map((g) => ({
    titulo: g.titulo,
    items: g.items
      .filter((i) => puedeVer(roles, i.href.split('?')[0])
        && (!i.soloRoles || i.soloRoles.some((r) => roles.includes(r)))
        && (!i.soloPermiso || permisosPropios.includes(i.soloPermiso)))
      .map((i) => ({
        href: i.href,
        nombre: i.nombre ?? i.label,
        familia: i.familia ?? null,
        bajada: TITULOS[i.href]?.bajada ?? TITULOS[i.href.split('?')[0]]?.bajada ?? '',
      })),
  })).filter((g) => g.items.length > 0);

  const pantallas = Object.fromEntries(GRUPOS.flatMap((g) => g.items.map((i) => [i.href, i.nombre ?? i.label])));
  const nombre = sesion.nombre?.trim().split(/\s+/)[0] ?? null;

  return (
    <Pantalla
      activo="/manual"
      ancho="angosto"
      titulo={esDueno ? 'Manual del dueño' : undefined}
      bajada={esDueno ? 'Preguntale lo que quieras, mirá tu día o recorré el sistema pantalla por pantalla' : undefined}
    >
      <Manual
        rol={sesion.rol}
        roles={roles}
        nombre={nombre}
        esDueno={esDueno}
        grupos={grupos}
        pantallas={pantallas}
        novedades={novedades}
      />
    </Pantalla>
  );
}
