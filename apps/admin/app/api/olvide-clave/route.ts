import { NextResponse } from 'next/server';

const API = process.env.API_URL ?? 'http://localhost:3001';

// Recuperar la clave: pedir el enlace, verificarlo y confirmar la clave nueva.
// Todo público (quien lo usa, justamente, no puede entrar al sistema).
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}) as any);
  const ruta =
    body?.accion === 'confirmar' ? '/auth/reseteo/confirmar' : '/auth/olvide-clave';
  const { accion, ...datos } = body ?? {};
  const res = await fetch(`${API}${ruta}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(datos),
  });
  return NextResponse.json(await res.json().catch(() => ({})), { status: res.status });
}

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get('token') ?? '';
  const res = await fetch(`${API}/auth/reseteo/verificar?token=${encodeURIComponent(token)}`, { cache: 'no-store' });
  return NextResponse.json(await res.json().catch(() => ({ valido: false })), { status: res.status });
}
