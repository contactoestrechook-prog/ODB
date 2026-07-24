import { SupabaseClient } from '@supabase/supabase-js';

// Resolución de credenciales de Mercado Pago multi-cuenta (una por razón social).
// Las credenciales viven en el env (nunca en la base); el slug de la sucursal
// (sucursales.mp_cuenta) define qué variables usar:
//   principal   → MERCADOPAGO_ACCESS_TOKEN / MERCADOPAGO_WEBHOOK_SECRET
//   <slug>      → MERCADOPAGO_ACCESS_TOKEN_<SLUG> / MERCADOPAGO_WEBHOOK_SECRET_<SLUG>

export type CuentaMP = {
  slug: string; // 'principal', 'santa_ines', ...
  token: string;
  secret?: string;
  sucursalIds: string[];
  userId?: string; // id de MP del cobrador (para resolver el webhook)
};

function sufijo(slug: string): string {
  return slug === 'principal' ? '' : `_${slug.toUpperCase()}`;
}

export function tokenDeSlug(slug: string): string | null {
  const t = process.env[`MERCADOPAGO_ACCESS_TOKEN${sufijo(slug)}`];
  return t && !t.startsWith('PEGAR') ? t : null;
}
export function secretDeSlug(slug: string): string | null {
  const s = process.env[`MERCADOPAGO_WEBHOOK_SECRET${sufijo(slug)}`];
  return s && !s.startsWith('PEGAR') ? s : null;
}

// Todas las cuentas MP configuradas (con token válido), con las sucursales que
// operan con cada una y su user_id (para el webhook).
export async function cuentasMP(db: SupabaseClient): Promise<CuentaMP[]> {
  const { data } = await db
    .from('sucursales')
    .select('id, mp_cuenta, mp_user_id')
    .not('mp_cuenta', 'is', null);
  const porSlug = new Map<string, CuentaMP>();
  for (const s of (data ?? []) as any[]) {
    const slug = s.mp_cuenta as string;
    const token = tokenDeSlug(slug);
    if (!token) continue; // cuenta declarada pero sin credenciales cargadas todavía
    const acc: CuentaMP = porSlug.get(slug) ?? { slug, token, secret: secretDeSlug(slug) ?? undefined, sucursalIds: [], userId: s.mp_user_id ?? undefined };
    acc.sucursalIds.push(s.id);
    if (s.mp_user_id) acc.userId = s.mp_user_id;
    porSlug.set(slug, acc);
  }
  return [...porSlug.values()];
}

// La cuenta MP de una sucursal puntual (para Comprá Fácil / links de pago).
export async function cuentaDeSucursal(db: SupabaseClient, sucursalId: string): Promise<CuentaMP | null> {
  const { data } = await db.from('sucursales').select('id, mp_cuenta, mp_user_id').eq('id', sucursalId).maybeSingle();
  if (!data?.mp_cuenta) return null;
  const token = tokenDeSlug(data.mp_cuenta);
  if (!token) return null;
  return { slug: data.mp_cuenta, token, secret: secretDeSlug(data.mp_cuenta) ?? undefined, sucursalIds: [data.id], userId: data.mp_user_id ?? undefined };
}
