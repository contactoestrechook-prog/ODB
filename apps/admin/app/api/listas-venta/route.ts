import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API = process.env.API_URL ?? 'http://localhost:3001';
const auth = async (): Promise<Record<string, string>> => {
  const t = (await cookies()).get('odb_token')?.value;
  return t ? { Authorization: `Bearer ${t}` } : {};
};

export async function GET() {
  const res = await fetch(`${API}/listas-venta`, { headers: await auth(), cache: 'no-store' });
  return NextResponse.json(await res.json(), { status: res.status });
}

// PATCH { id, ...cambios }
export async function PATCH(req: Request) {
  const { id, ...cambios } = await req.json().catch(() => ({}));
  const res = await fetch(`${API}/listas-venta/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...(await auth()) },
    body: JSON.stringify(cambios),
  });
  return NextResponse.json(await res.json(), { status: res.status });
}

// POST { id } → regenerar precios de esa lista desde Minorista
export async function POST(req: Request) {
  const { id } = await req.json().catch(() => ({}));
  const res = await fetch(`${API}/listas-venta/${id}/regenerar`, { method: 'POST', headers: await auth() });
  return NextResponse.json(await res.json(), { status: res.status });
}
