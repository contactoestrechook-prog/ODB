// PERMISOS POR PERSONA, ADEMÁS DEL ROL (25/11/2026): usuarios.permisos guarda lo que
// alguien puede además de lo de su rol («caja_dueno» de Juan Pablo,
// «pagar_anular_facturas» de Anabella). Se lee de la base en cada pedido: se da o se
// saca y vale en el momento, sin volver a entrar. Si la lectura falla o la persona
// está dada de baja, no hay permiso.

import type { SupabaseClient } from '@supabase/supabase-js';

export async function tienePermiso(db: SupabaseClient, usuarioId: string | null | undefined, permiso: string): Promise<boolean> {
  const id = String(usuarioId ?? '').trim();
  if (!id || !permiso) return false;
  try {
    const { data, error } = await db.from('usuarios').select('permisos, activo').eq('id', id).maybeSingle();
    if (error || !data || (data as any).activo === false) return false;
    const permisos = (data as any).permisos;
    return Array.isArray(permisos) && permisos.map(String).includes(permiso);
  } catch {
    return false;
  }
}
