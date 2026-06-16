import { Header } from '../ui/Header';
import { apiFetch } from '../../lib/api';
import { ComparadorWorkspace } from '../ui/ComparadorWorkspace';

export const dynamic = 'force-dynamic';

export default async function Comparador() {
  let comparacion: any[] = [];
  let proveedores: any[] = [];
  let error: string | null = null;
  try {
    const [rc, rp] = await Promise.all([apiFetch('/comparador'), apiFetch('/comparador/proveedores')]);
    if (rc.ok) comparacion = await rc.json();
    if (rp.ok) proveedores = await rp.json();
    if (!rc.ok && !rp.ok) throw new Error('La API respondió con error');
  } catch (e) {
    error = e instanceof Error ? e.message : 'Error desconocido';
  }

  return (
    <main className="min-h-screen bg-[#F0EBE2] lg:pl-64">
      <Header activo="/comparador" />
      <div className="max-w-5xl mx-auto p-6">
        {error ? (
          <p className="rounded-lg bg-white p-4 text-sm text-[#932A1F]">No pude consultar la API ({error}).</p>
        ) : (
          <ComparadorWorkspace comparacion={comparacion} proveedores={proveedores} />
        )}
      </div>
    </main>
  );
}
