import { Header } from '../ui/Header';
import { apiFetch } from '../../lib/api';
import { FormularioLista } from './FormularioLista';

export const dynamic = 'force-dynamic';

export default async function Listas() {
  let proveedores: { id: string; razon_social: string }[] = [];
  try {
    const res = await apiFetch('/proveedores');
    if (res.ok) proveedores = await res.json();
  } catch {}

  return (
    <main className="min-h-screen bg-[#F0EBE2]">
      <Header activo="/listas" />
      <div className="max-w-5xl mx-auto p-6">
        <FormularioLista proveedores={proveedores} />
      </div>
    </main>
  );
}
