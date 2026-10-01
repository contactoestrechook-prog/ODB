import { Pantalla } from '../ui/kit/Pantalla';
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
    <Pantalla activo="/responde" ancho="ancho">
      <RespondeWorkspace tokenResponde={tokenResponde} />
    </Pantalla>
  );
}
