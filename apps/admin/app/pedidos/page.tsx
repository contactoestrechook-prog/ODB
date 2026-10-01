import { Pantalla } from '../ui/kit/Pantalla';
import { Aviso } from '../ui/kit';
import { apiFetch } from '../../lib/api';
import { PedidosWorkspace } from '../ui/PedidosWorkspace';

export const dynamic = 'force-dynamic';

export default async function Pedidos() {
  let pedidos: any[] = [];
  let error: string | null = null;
  try {
    const r = await apiFetch('/pedidos');
    if (r.ok) pedidos = await r.json();
    else throw new Error('La API respondió con error');
  } catch (e) {
    error = e instanceof Error ? e.message : 'Error desconocido';
  }

  return (
    <Pantalla activo="/pedidos" ancho="ancho">
      {error ? (
        <Aviso tono="error">No pude consultar la API ({error}).</Aviso>
      ) : (
        <PedidosWorkspace inicial={pedidos} />
      )}
    </Pantalla>
  );
}
