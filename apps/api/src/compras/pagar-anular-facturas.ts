// FACTURAS DE COMPRA: QUIÉN REGISTRA PAGOS Y ANULA DIRECTO (25/11/2026). Leandro,
// con las dos pantallas de la Factura A 0056-00599572 de Bodegas Esmeralda: «esto
// es lo que ve Juampi desde su usuario y necesito que Ana vea lo mismo»; «el dueño
// me está pidiendo ese cambio, así que podemos hacerlo solo con Anabella»; y
// «solamente con respecto a las imágenes que te pasé, claramente no todo».
//
// Las imágenes muestran dos cosas: «Pagos registrados» (registrar un pago) y
// «Anular factura». Eso lo hacen directo gerencia y los dueños, como siempre, y
// además quien tenga el permiso `pagar_anular_facturas` en usuarios.permisos (hoy,
// solo Anabella). Corregir la factura o sus renglones sigue siendo de gerencia y
// dueños: ella lo pide y lo aprueba un dueño. Romina, del mismo rol, no tiene el
// permiso. Los cambios pendientes los sigue aprobando solo un dueño.
//
// El permiso se lee de la base en cada pedido (no del token): se da o se saca y
// vale en el momento, sin volver a entrar. Si la lectura falla, no hay permiso.

import type { SupabaseClient } from '@supabase/supabase-js';
import { rolesDe } from '../auth/roles';

export const PERMISO_PAGAR_ANULAR = 'pagar_anular_facturas';

const ROLES_DIRECTO = ['gerente', 'dueno'];

export const NO_PAGA_NI_ANULA = 'Esto lo hace gerencia, un dueño o quien tenga el permiso: la anulación se pide con «Anular factura» y la aprueba un dueño.';

type Usuario = { sub?: string | null; rol?: string | null; roles?: unknown } | null | undefined;

export async function pagaYAnulaFacturas(db: SupabaseClient, usuario: Usuario): Promise<boolean> {
  if (rolesDe(usuario).some((r) => ROLES_DIRECTO.includes(r))) return true;
  const id = String(usuario?.sub ?? '').trim();
  if (!id) return false;
  try {
    const { data, error } = await db.from('usuarios').select('permisos, activo').eq('id', id).maybeSingle();
    if (error || !data || (data as any).activo === false) return false;
    const permisos = (data as any).permisos;
    return Array.isArray(permisos) && permisos.map(String).includes(PERMISO_PAGAR_ANULAR);
  } catch {
    return false;
  }
}
