import { cookies } from 'next/headers';
import { Pantalla } from '../ui/kit/Pantalla';
import { ColaDeposito } from './ColaDeposito';
import { puedeCargarRepartidores, rolDesdeToken } from '../lib/permisos';

export default async function Deposito() {
  // el link «cargá un repartidor» de la ventana de despachar es solo para quien
  // puede cargarlos (gerencia y dueño); depósito no abre Reparto
  const rol = rolDesdeToken((await cookies()).get('odb_token')?.value);
  return (
    <Pantalla activo="/deposito" ancho="ancho">
      <ColaDeposito puedeCargarRepartidor={puedeCargarRepartidores(rol)} />
    </Pantalla>
  );
}
