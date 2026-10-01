import { Pantalla } from '../ui/kit/Pantalla';
import { apiFetch } from '../../lib/api';
import { TiendaNubeWorkspace } from '../ui/TiendaNubeWorkspace';

export const dynamic = 'force-dynamic';

export default async function TiendaNube() {
  let inicial: any = { configurado: false };
  try {
    const r = await apiFetch('/tiendanube/estado');
    if (r.ok) inicial = await r.json();
  } catch {
    /* la API puede estar caída; el workspace muestra "no conectado" */
  }

  return (
    <Pantalla activo="/tiendanube" ancho="angosto">
      <TiendaNubeWorkspace inicial={inicial} />
    </Pantalla>
  );
}
