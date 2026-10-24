import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API = process.env.API_URL ?? 'http://localhost:3001';
async function tok(): Promise<Record<string, string>> { const t = (await cookies()).get('odb_token')?.value; return t ? { Authorization: `Bearer ${t}` } : {}; }

// estado de cuenta de un cliente: movimientos y resúmenes que recibió
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await fetch(`${API}/cta-cte/cliente/${encodeURIComponent(id)}`, { headers: await tok(), cache: 'no-store' });
  return NextResponse.json(await res.json(), { status: res.status });
}

// { recibeResumen?, telefono? }
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await fetch(`${API}/cta-cte/cliente/${encodeURIComponent(id)}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', ...(await tok()) }, body: JSON.stringify(await req.json()),
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
