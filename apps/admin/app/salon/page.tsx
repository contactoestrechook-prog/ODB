import { cookies } from 'next/headers';
import { apiFetch } from '../../lib/api';
import { Pantalla } from '../ui/kit/Pantalla';
import { SalonWorkspace } from '../ui/SalonWorkspace';
import { datosDesdeToken, sucursalDesdeToken } from '../lib/permisos';

export const dynamic = 'force-dynamic';

// Op salón (5/11/2026): armar lo asignado, stock con su lugar y puerta de depósito.
// Para el op salón es la ÚNICA pantalla y es de celular: sin el menú del sistema
// (Leandro: «100 mobile… que no accedan ni a cajas ni a administración ni a nada»).
export default async function Salon() {
  const token = (await cookies()).get('odb_token')?.value;
  const { rol, nombre } = datosDesdeToken(token);
  const esOp = rol === 'op_salon';
  let proveedores: any[] = [];
  let sucursales: any[] = [];
  try {
    const [rp, rs] = await Promise.all([apiFetch('/proveedores'), apiFetch('/sucursales')]);
    if (rp.ok) proveedores = await rp.json();
    if (rs.ok) sucursales = await rs.json();
  } catch {
    // las pestañas avisan solas si la API no responde
  }
  const propia = sucursalDesdeToken(token);
  const trabajo = (
    <SalonWorkspace
      proveedores={(proveedores ?? []).filter((p: any) => p.activo !== false).map((p: any) => ({ id: p.id, nombre: p.nombre }))}
      // el op salón trabaja en SU sucursal
      sucursales={(sucursales ?? []).filter((s: any) => !esOp || s.id === propia).map((s: any) => ({ id: s.id, nombre: s.nombre }))}
      sucursalPropia={propia}
      verTodos={!esOp}
    />
  );
  if (!esOp) return <Pantalla activo="/salon">{trabajo}</Pantalla>;

  const sucursal = (sucursales ?? []).find((s: any) => s.id === propia)?.nombre ?? null;
  return (
    <main className="min-h-dvh bg-crema">
      <header className="sticky top-0 z-30 flex items-center gap-3 bg-tinta px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] text-white">
        <div className="min-w-0 flex-1">
          <p className="text-base font-bold leading-tight">Salón{sucursal ? ` · ${sucursal}` : ''}</p>
          <p className="truncate text-xs text-white/70">{nombre ?? ''}</p>
        </div>
        <a href="/cambiar-clave" className="rounded-full px-3 py-1.5 text-xs text-white/80 hover:bg-white/10">Mi clave</a>
        <a href="/api/salir" className="rounded-full border border-white/25 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/10">Salir</a>
      </header>
      <div className="mx-auto w-full max-w-lg px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-3">{trabajo}</div>
    </main>
  );
}
