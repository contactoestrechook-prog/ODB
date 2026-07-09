import { Header } from '../ui/Header';
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
    <main className="min-h-screen bg-[#F0EBE2] lg:pl-64">
      <Header activo="/conteo" />
      <div className="p-4 lg:p-6 max-w-4xl">
        <ConteoWorkspace sucursales={sucursales} conteosIniciales={conteos} />
      </div>
    </main>
  );
}
