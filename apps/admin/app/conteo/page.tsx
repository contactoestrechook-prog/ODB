import { Pantalla } from '../ui/kit/Pantalla';
import { apiFetch } from '../../lib/api';
import { ConteoWorkspace } from '../ui/ConteoWorkspace';

export const dynamic = 'force-dynamic';

export default async function Conteo() {
  let sucursales: { id: string; nombre: string }[] = [];
  let conteos: any[] = [];
  try {
    const [rs, rc] = await Promise.all([
      apiFetch('/sucursales'),
      apiFetch('/stock/conteos'),
    ]);
    if (rs.ok) sucursales = await rs.json();
    if (rc.ok) conteos = await rc.json();
  } catch {}

  return (
    <Pantalla activo="/conteo">
      <ConteoWorkspace sucursales={sucursales} conteosIniciales={conteos} />
    </Pantalla>
  );
}
