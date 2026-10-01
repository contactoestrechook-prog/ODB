import { Pantalla } from '../ui/kit/Pantalla';
import { apiFetch } from '../../lib/api';
import { VerificadorPrecios } from '../ui/VerificadorPrecios';

export const dynamic = 'force-dynamic';

// Verificador de precios: la pantalla que usa el salón con el equipo de mano.
// Al imprimir, solo sale la etiqueta: el resto de la página (menú y cabecera
// incluidos) lo esconden las reglas de impresión de VerificadorPrecios.
export default async function Precios() {
  let sucursales: { id: string; nombre: string }[] = [];
  try {
    const r = await apiFetch('/sucursales');
    if (r.ok) sucursales = await r.json();
  } catch { /* sin sucursales igual se consulta el precio */ }

  return (
    <Pantalla activo="/precios" ancho="angosto">
      <VerificadorPrecios sucursales={sucursales} />
    </Pantalla>
  );
}
