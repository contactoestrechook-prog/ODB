import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API = process.env.API_URL ?? 'http://localhost:3001';

async function conToken(): Promise<Record<string, string>> {
  const token = (await cookies()).get('odb_token')?.value;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function GET() {
  const res = await fetch(`${API}/pedidos`, { headers: await conToken(), cache: 'no-store' });
  return NextResponse.json(await res.json(), { status: res.status });
}

export async function POST(req: Request) {
  const body = await req.json();
  const url = body.simular
    ? `${API}/pedidosya/simular`
    : `${API}/pedidos/${body.pedidoId}/avanzar`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await conToken()) },
    body: JSON.stringify(body.simular ? {} : { estado: body.estado }),
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
