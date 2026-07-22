import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API = process.env.API_URL ?? 'http://localhost:3001';

async function auth(): Promise<Record<string, string>> {
  const token = (await cookies()).get('odb_token')?.value;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// GET ?recurso=estado|resumen|pagos&dias=30
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const recurso = sp.get('recurso') ?? 'resumen';
  const dias = sp.get('dias') ?? '30';
  const res = await fetch(`${API}/mercadopago/${recurso}?dias=${encodeURIComponent(dias)}`, {
    headers: await auth(),
    cache: 'no-store',
  });
  return NextResponse.json(await res.json(), { status: res.status });
}

// POST { accion: 'importar'|'link', ... }
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const accion = body?.accion === 'link' ? 'link' : 'importar';
  const res = await fetch(`${API}/mercadopago/${accion}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await auth()) },
    body: JSON.stringify(body ?? {}),
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
