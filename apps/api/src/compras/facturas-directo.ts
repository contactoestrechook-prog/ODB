// FACTURAS DE COMPRA: QUIÉN CORRIGE, ANULA Y PAGA DIRECTO (25/11/2026). Leandro,
// con las dos pantallas de la Factura A 0056-00599572 de Bodegas Esmeralda: «esto
// es lo que ve Juampi desde su usuario y necesito que Ana vea lo mismo», y
// después: «el dueño me está pidiendo ese cambio, así que podemos hacerlo solo
// con Anabella».
//
// Gerencia y dueños lo hacen directo, como siempre. Además, la persona que tenga
// el permiso `facturas_directo` en usuarios.permisos (hoy, solo Anabella). Romina,
// del mismo rol, sigue pidiéndolo y lo aprueba un dueño. Los cambios pendientes
// los sigue aprobando solo un dueño.
//
// El permiso se lee de la base en cada pedido (no del token): se da o se saca y
// vale en el momento, sin volver a entrar. Si la lectura falla, no hay permiso.

import type { SupabaseClient } from '@supabase/supabase-js';
import { rolesDe } from '../auth/roles';

export const PERMISO_FACTURAS_DIRECTO = 'facturas_directo';

const ROLES_DIRECTO = ['gerente', 'dueno'];

export const NO_HACE_DIRECTO = 'Esto lo hace gerencia, un dueño o quien tenga el permiso: pedilo con «Pedir cambio» y lo aprueba un dueño.';

type Usuario = { sub?: string | null; rol?: string | null; roles?: unknown } | null | undefined;

export async function haceFacturasDirecto(db: SupabaseClient, usuario: Usuario): Promise<boolean> {
  if (rolesDe(usuario).some((r) => ROLES_DIRECTO.includes(r))) return true;
  const id = String(usuario?.sub ?? '').trim();
  if (!id) return false;
  try {
    const { data, error } = await db.from('usuarios').select('permisos, activo').eq('id', id).maybeSingle();
    if (error || !data || (data as any).activo === false) return false;
    const permisos = (data as any).permisos;
    return Array.isArray(permisos) && permisos.map(String).includes(PERMISO_FACTURAS_DIRECTO);
  } catch {
    return false;
  }
}
