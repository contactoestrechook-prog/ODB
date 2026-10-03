import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API = process.env.API_URL ?? 'http://localhost:3001';

async function auth(): Promise<Record<string, string> | null> {
  const token = (await cookies()).get('odb_token')?.value;
  return token ? { Authorization: `Bearer ${token}` } : null;
}

// Avisos a administración que no salieron o no llegaron (3/10/2026). Si el API
// no contesta, se dice (error): la franja no puede quedar vacía en silencio.
export async function GET() {
  const headers = await auth();
  if (!headers) return NextResponse.json({ problemas: [] });
  const res = await fetch(`${API}/avisos/pedidos`, { headers, cache: 'no-store' }).catch(() => null);
  if (!res?.ok) return NextResponse.json({ problemas: [], error: 'el sistema no contesta' });
  return NextResponse.json(await res.json());
}

// "Ya avisé al local"
export async function POST(req: Request) {
  const headers = await auth();
  const { id } = await req.json().catch(() => ({}) as any);
  if (!headers || !id) return NextResponse.json({ ok: false }, { status: 400 });
  const res = await fetch(`${API}/avisos/pedidos/${encodeURIComponent(id)}/visto`, { method: 'POST', headers }).catch(() => null);
  return NextResponse.json(await res?.json().catch(() => ({})) ?? {}, { status: res?.status ?? 502 });
}
