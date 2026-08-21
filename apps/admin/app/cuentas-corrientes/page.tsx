import { cookies } from 'next/headers';
import { Header } from '../ui/Header';
import { CtaCteTablero } from '../ui/CtaCteTablero';
import { datosDesdeToken } from '../lib/permisos';

export const dynamic = 'force-dynamic';

export default async function CuentasCorrientes() {
  const rol = datosDesdeToken((await cookies()).get('odb_token')?.value).rol;
  return (
    <main className="min-h-screen bg-[#F0EBE2] lg:pl-64">
      <Header activo="/cuentas-corrientes" />
      <div className="max-w-5xl mx-auto p-6">
        <CtaCteTablero esDueno={rol === 'dueno'} />
      </div>
    </main>
  );
}
