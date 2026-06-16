import { Header } from '../ui/Header';
import { apiFetch } from '../../lib/api';
import { MensajesWorkspace } from '../ui/MensajesWorkspace';

export const dynamic = 'force-dynamic';

export default async function Mensajes() {
  let resumen: any = {};
  let solicitudes: any[] = [];
  let error: string | null = null;
  try {
    const [rr, rs] = await Promise.all([apiFetch('/mensajes/resumen'), apiFetch('/solicitudes')]);
    if (rr.ok) resumen = await rr.json();
    if (rs.ok) solicitudes = await rs.json();
    if (!rr.ok) throw new Error('La API respondió con error');
  } catch (e) {
    error = e instanceof Error ? e.message : 'Error desconocido';
  }

  return (
    <main className="min-h-screen bg-[#F0EBE2] lg:pl-64">
      <Header activo="/mensajes" />
      <div className="max-w-5xl mx-auto p-6">
        {error ? (
          <p className="rounded-lg bg-white p-4 text-sm text-[#932A1F]">No pude consultar la API ({error}).</p>
        ) : (
          <MensajesWorkspace resumen={resumen} solicitudesInicial={solicitudes} />
        )}
      </div>
    </main>
  );
}
