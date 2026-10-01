import { Header } from '../ui/Header';
import { RespondeWorkspace } from '../ui/RespondeWorkspace';
import { tokenDelPanelResponde } from '../lib/responde';

export const dynamic = 'force-dynamic';

export default async function Responde() {
  // El que ya entró a ODB como dueño no tiene por qué ver un SEGUNDO cartel de
  // contraseña adentro del panel. La app de RESPONDE se empotra con el token
  // del tenant —el mismo camino que usa /whatsapp, que ya funcionaba— en lugar
  // de la clave legacy por URL, que dependía de una variable que nunca se
  // configuró y dejaba la pantalla pidiendo usuario y clave.
  const tokenResponde = await tokenDelPanelResponde();
  return (
    <main className="min-h-screen bg-[#F0EBE2] lg:pl-64">
      <Header activo="/responde" />
      <div className="max-w-6xl mx-auto p-6">
        <RespondeWorkspace tokenResponde={tokenResponde} />
      </div>
    </main>
  );
}
