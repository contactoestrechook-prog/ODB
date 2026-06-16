import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API = process.env.API_URL ?? 'http://localhost:3001';

async function tok(): Promise<Record<string, string>> {
  const t = (await cookies()).get('odb_token')?.value;
  return t ? { Authorization: `Bearer ${t}` } : {};
}

export async function GET(req: Request) {
  const recurso = new URL(req.url).searchParams.get('recurso') ?? 'comparacion';
  const ruta = recurso === 'proveedores' ? '/comparador/proveedores' : '/comparador';
  const res = await fetch(`${API}${ruta}`, { headers: await tok(), cache: 'no-store' });
  return NextResponse.json(await res.json(), { status: res.status });
}

export async function PATCH(req: Request) {
  const headers = { 'Content-Type': 'application/json', ...(await tok()) };
  const { id, ...d } = await req.json().catch(() => ({}));
  const res = await fetch(`${API}/comparador/proveedor/${id}`, { method: 'PATCH', headers, body: JSON.stringify(d) });
  return NextResponse.json(await res.json(), { status: res.status });
}
