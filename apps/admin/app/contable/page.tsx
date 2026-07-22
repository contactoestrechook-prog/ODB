import { Header } from '../ui/Header';
import { apiFetch } from '../../lib/api';
import { ContableWorkspace } from '../ui/ContableWorkspace';

export const dynamic = 'force-dynamic';

export default async function Contable() {
  let inicial: any = null;
  let error: string | null = null;
  try {
    const res = await apiFetch('/contable');
    if (!res.ok) throw new Error(`API respondió ${res.status}`);
    inicial = await res.json();
  } catch (e) {
    error = e instanceof Error ? e.message : 'Error desconocido';
  }

  return (
    <main className="min-h-screen bg-[#F0EBE2] lg:pl-64">
      <Header activo="/contable" />
      <div className="max-w-5xl mx-auto p-6">
        {error ? (
          <p className="rounded-lg bg-white p-4 text-sm text-[#932A1F]">No pude consultar la API ({error}).</p>
        ) : (
          <ContableWorkspace inicial={inicial} />
        )}
      </div>
    </main>
  );
}
