import { cookies } from 'next/headers';
import { Pantalla } from '../ui/kit/Pantalla';
import { ColaDeposito } from './ColaDeposito';
import { datosDesdeToken, puedeCargarRepartidores, rolDesdeToken, rolesDesdeToken, veTodoElArmado } from '../lib/permisos';

export default async function Deposito() {
  // el link «cargá un repartidor» de la ventana de despachar es solo para quien
  // puede cargarlos (gerencia y dueño); depósito no abre Reparto
  const token = (await cookies()).get('odb_token')?.value;
  const rol = rolDesdeToken(token);
  // lo que le asignaron para armar le sale arriba de todo (19/11/2026)
  const { sub: miId } = datosDesdeToken(token);
  return (
    <Pantalla activo="/deposito" ancho="completo">
      <ColaDeposito puedeCargarRepartidor={puedeCargarRepartidores(rol)} miId={miId} veTodo={veTodoElArmado(rolesDesdeToken(token))} />
    </Pantalla>
  );
}
