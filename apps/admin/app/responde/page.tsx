import { Header } from '../ui/Header';
import { apiFetch } from '../../lib/api';
import { RespondeWorkspace } from '../ui/RespondeWorkspace';

export const dynamic = 'force-dynamic';

export default async function Responde() {
  let resumen: any = {};
  let conversaciones: any[] = [];
  let error: string | null = null;
  try {
    const [rr, rc] = await Promise.all([
      apiFetch('/bot/responde/resumen'),
      apiFetch('/bot/conversaciones'),
    ]);
    if (rr.ok) resumen = await rr.json();
    if (rc.ok) conversaciones = await rc.json();
    if (!rr.ok && !rc.ok) throw new Error('La API respondió con error');
  } catch (e) {
    error = e instanceof Error ? e.message : 'Error desconocido';
  }

  return (
    <main className="min-h-screen bg-[#F0EBE2] lg:pl-64">
      <Header activo="/responde" />
      <div className="max-w-6xl mx-auto p-6">
        {error ? (
          <p className="rounded-lg bg-white p-4 text-sm text-[#932A1F]">No pude consultar la API ({error}).</p>
        ) : (
          <RespondeWorkspace
            resumenInicial={resumen}
            conversacionesInicial={conversaciones}
            sinClave={Boolean(process.env.RESPONDE_PANEL_KEY)}
          />
        )}
      </div>
    </main>
  );
}
