import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API = process.env.API_URL ?? 'http://localhost:3001';

// { nombre }: corregir el nombre de un contacto
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = (await cookies()).get('odb_token')?.value;
  const res = await fetch(`${API}/agenda/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(await req.json().catch(() => ({}))),
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
