import { Header } from '../ui/Header';
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
    <main className="min-h-screen bg-[#F0EBE2] lg:pl-64">
      <Header activo="/tiendanube" />
      <div className="max-w-4xl mx-auto p-6">
        <TiendaNubeWorkspace inicial={inicial} />
      </div>
    </main>
  );
}
