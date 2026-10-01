import { Pantalla } from '../ui/kit/Pantalla';
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
    <Pantalla activo="/listas">
      <FormularioLista proveedores={proveedores} />
    </Pantalla>
  );
}
