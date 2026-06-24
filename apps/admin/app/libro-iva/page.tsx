import { Header } from '../ui/Header';
import { apiFetch } from '../../lib/api';
import { LibroIvaWorkspace } from '../ui/LibroIvaWorkspace';

export const dynamic = 'force-dynamic';

export default async function LibroIva() {
  let inicial: any = null;
  let error: string | null = null;
  try {
    const r = await apiFetch('/facturacion/libro-iva');
    if (r.ok) inicial = await r.json();
    else throw new Error('La API respondió con error');
  } catch (e) {
    error = e instanceof Error ? e.message : 'Error desconocido';
  }

  return (
    <main className="min-h-screen bg-[#F0EBE2] lg:pl-64 print:bg-white print:pl-0">
      <div className="print:hidden">
        <Header activo="/libro-iva" />
      </div>
      <div className="max-w-5xl mx-auto p-6 print:p-0">
        {error ? (
          <p className="rounded-lg bg-white p-4 text-sm text-[#932A1F]">No pude consultar la API ({error}).</p>
        ) : (
          <LibroIvaWorkspace inicial={inicial} />
        )}
      </div>
    </main>
  );
}
