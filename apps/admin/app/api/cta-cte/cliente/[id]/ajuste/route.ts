import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API = process.env.API_URL ?? 'http://localhost:3001';

// { monto, motivo }: corregir el saldo con un movimiento (solo el dueño: lo controla el API)
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = (await cookies()).get('odb_token')?.value;
  const res = await fetch(`${API}/cta-cte/cliente/${encodeURIComponent(id)}/ajuste`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(await req.json().catch(() => ({}))),
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
