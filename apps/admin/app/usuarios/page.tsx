import { Header } from '../ui/Header';
import { apiFetch } from '../../lib/api';
import { GestionUsuarios } from '../ui/GestionUsuarios';

export const dynamic = 'force-dynamic';

export default async function Usuarios() {
  const [resUsuarios, resSucursales] = await Promise.all([
    apiFetch('/usuarios'),
    apiFetch('/usuarios/sucursales'),
  ]);
  const usuarios = resUsuarios.ok ? await resUsuarios.json() : [];
  const sucursales = resSucursales.ok ? await resSucursales.json() : [];

  return (
    <div className="min-h-screen bg-[#F0EBE2] lg:pl-64">
      <Header activo="/usuarios" />
      <main className="max-w-5xl mx-auto p-6">
        {!resUsuarios.ok ? (
          <section className="rounded-xl bg-white p-8 text-center text-black/50 text-sm">
            No tenés permisos para administrar usuarios (requiere rol dueño o gerente).
          </section>
        ) : (
          <GestionUsuarios usuarios={usuarios} sucursales={sucursales} />
        )}
      </main>
    </div>
  );
}
