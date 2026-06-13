import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API = process.env.API_URL ?? 'http://localhost:3001';

async function token() {
  return (await cookies()).get('odb_token')?.value;
}

// crear promoción (DTO completo)
export async function POST(req: Request) {
  const t = await token();
  const res = await fetch(`${API}/descuentos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) },
    body: JSON.stringify(await req.json().catch(() => ({}))),
  });
  return NextResponse.json(await res.json(), { status: res.status });
}

// activar / pausar: { id, activo }
export async function PATCH(req: Request) {
  const t = await token();
  const { id, ...body } = await req.json().catch(() => ({}));
  const res = await fetch(`${API}/descuentos/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) },
    body: JSON.stringify(body),
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
