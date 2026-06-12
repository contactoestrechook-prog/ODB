import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API = process.env.API_URL ?? 'http://localhost:3001';

async function conToken() {
  const token = (await cookies()).get('odb_token')?.value;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function GET(req: Request) {
  const codigo = new URL(req.url).searchParams.get('codigo') ?? '';
  const res = await fetch(`${API}/salida/${encodeURIComponent(codigo)}`, {
    headers: await conToken(),
    cache: 'no-store',
  });
  return NextResponse.json(await res.json(), { status: res.status });
}

export async function POST(req: Request) {
  const { codigo } = await req.json();
  const res = await fetch(`${API}/salida/${encodeURIComponent(codigo)}/validar`, {
    method: 'POST',
    headers: await conToken(),
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
