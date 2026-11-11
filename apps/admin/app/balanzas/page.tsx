import { cookies } from 'next/headers';
import { Pantalla } from '../ui/kit/Pantalla';
import { rolDesdeToken } from '../lib/permisos';
import { BalanzasLista } from '../ui/BalanzasLista';

export const dynamic = 'force-dynamic';

// Balanzas (Leandro, 11/11/2026: «sí, armala»): la lista de PLU con precio para
// cargar en las balanzas Kretz con iTegra. Bajarla: depósito, administración,
// compras, gerencia y dueño. Sumar o sacar un producto por unidad: quien decide
// el catálogo (la API lo controla igual, con @Roles).
export default async function PaginaBalanzas() {
  const rol = rolDesdeToken((await cookies()).get('odb_token')?.value);
  const puedeMarcar = rol === 'dueno' || rol === 'gerente' || rol === 'comprador' || rol === 'administrativo';
  return (
    <Pantalla activo="/balanzas">
      <BalanzasLista puedeMarcar={puedeMarcar} />
    </Pantalla>
  );
}
