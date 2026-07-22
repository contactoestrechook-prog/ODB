import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API = process.env.API_URL ?? 'http://localhost:3001';

async function auth(): Promise<Record<string, string>> {
  const token = (await cookies()).get('odb_token')?.value;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// GET ?recurso=estado|pendientes|contador&mes=YYYY-MM
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const recurso = sp.get('recurso') ?? 'contador';
  const mes = sp.get('mes') ?? '';
  const res = await fetch(`${API}/arca/${recurso}${mes ? `?mes=${encodeURIComponent(mes)}` : ''}`, {
    headers: await auth(),
    cache: 'no-store',
  });
  return NextResponse.json(await res.json(), { status: res.status });
}

// POST { accion: 'emitir' }
export async function POST() {
  const res = await fetch(`${API}/arca/emitir`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await auth()) },
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
