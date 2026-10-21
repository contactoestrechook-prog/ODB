import { redirect } from 'next/navigation';

// Repartidores ahora es una sección de Reparto (21/10/2026): la dirección vieja
// sigue andando para quien la tenga guardada.
export default function Repartidores() {
  redirect('/reparto?vista=repartidores');
}
