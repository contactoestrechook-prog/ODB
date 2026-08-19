import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API = process.env.API_URL ?? 'http://localhost:3001';

async function auth(): Promise<Record<string, string>> {
  const token = (await cookies()).get('odb_token')?.value;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// Novedades del sistema (?que=novedades, default) o alertas internas (?que=alertas)
export async function GET(req: Request) {
  const headers = await auth();
  if (!headers.Authorization) return NextResponse.json([]);
  const que = new URL(req.url).searchParams.get('que') ?? 'novedades';
  const ruta = que === 'alertas' ? '/novedades/alertas' : '/novedades/pendientes';
  const res = await fetch(`${API}${ruta}`, { headers, cache: 'no-store' });
  if (!res.ok) return NextResponse.json([]);
  return NextResponse.json(await res.json());
}

// Marcar una novedad como vista, o una alerta como leída (que: 'alerta')
export async function POST(req: Request) {
  const { id, que } = await req.json().catch(() => ({}) as any);
  if (!id) return NextResponse.json({ ok: false }, { status: 400 });
  const ruta = que === 'alerta' ? `/novedades/alertas/${encodeURIComponent(id)}/leida` : `/novedades/${encodeURIComponent(id)}/vista`;
  const res = await fetch(`${API}${ruta}`, {
    method: 'POST',
    headers: await auth(),
  });
  return NextResponse.json(await res.json().catch(() => ({})), { status: res.status });
}
