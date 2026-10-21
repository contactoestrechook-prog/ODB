import { cookies } from 'next/headers';
import { Pantalla } from '../ui/kit/Pantalla';
import { rolDesdeToken } from '../lib/permisos';
import { Fraccionar } from './Fraccionar';

export const dynamic = 'force-dynamic';

export default async function PaginaFraccionar() {
  // Solo para mostrar u ocultar botones: la que decide es la API (@Roles).
  // Configurar el grupo: gerencia y dueño. Cargar el pozo: los mismos que
  // hacen ajustes de stock (depósito con PIN de supervisor arriba del tope).
  const rol = rolDesdeToken((await cookies()).get('odb_token')?.value);
  const puedeConfigurar = rol === 'dueno' || rol === 'gerente';
  const puedeCargarPozo = puedeConfigurar || rol === 'deposito' || rol === 'administrativo';
  return (
    <Pantalla activo="/fraccionar">
      <Fraccionar puedeConfigurar={puedeConfigurar} puedeCargarPozo={puedeCargarPozo} />
    </Pantalla>
  );
}
