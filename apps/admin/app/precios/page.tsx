import { Header } from '../ui/Header';
import { apiFetch } from '../../lib/api';
import { VerificadorPrecios } from '../ui/VerificadorPrecios';

export const dynamic = 'force-dynamic';

// Verificador de precios: la pantalla que usa el salón con el equipo de mano.
export default async function Precios() {
  let sucursales: { id: string; nombre: string }[] = [];
  try {
    const r = await apiFetch('/sucursales');
    if (r.ok) sucursales = await r.json();
  } catch { /* sin sucursales igual se consulta el precio */ }

  return (
    <main className="min-h-screen bg-[#F0EBE2] lg:pl-64">
      <div className="print:hidden"><Header activo="/precios" /></div>
      <VerificadorPrecios sucursales={sucursales} />
    </main>
  );
}
