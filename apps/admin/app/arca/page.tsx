import { Header } from '../ui/Header';
import { apiFetch } from '../../lib/api';
import { ArcaWorkspace } from '../ui/ArcaWorkspace';

export const dynamic = 'force-dynamic';

export default async function Arca() {
  let estado: any = { configurado: false };
  let contador: any = null;
  let pendientes: any = { comprobantes: [] };
  let error: string | null = null;
  try {
    const [re, rc, rp] = await Promise.all([
      apiFetch('/arca/estado'),
      apiFetch('/arca/contador'),
      apiFetch('/arca/pendientes'),
    ]);
    if (re.ok) estado = await re.json();
    if (rc.ok) contador = await rc.json();
    if (rp.ok) pendientes = await rp.json();
    if (!rc.ok) throw new Error('La API respondió con error');
  } catch (e) {
    error = e instanceof Error ? e.message : 'Error desconocido';
  }

  return (
    <main className="min-h-screen bg-[#F0EBE2] lg:pl-64">
      <Header activo="/arca" />
      <div className="max-w-5xl mx-auto p-6">
        {error ? (
          <p className="rounded-lg bg-white p-4 text-sm text-[#932A1F]">No pude consultar la API ({error}).</p>
        ) : (
          <ArcaWorkspace estado={estado} contador={contador} pendientes={pendientes} />
        )}
      </div>
    </main>
  );
}
