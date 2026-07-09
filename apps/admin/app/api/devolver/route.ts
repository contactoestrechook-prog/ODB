import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API = process.env.API_URL ?? 'http://localhost:3001';

// Devolución parcial de una venta (requiere autorización de supervisor)
export async function POST(req: Request) {
  const { ventaId, ...dto } = await req.json();
  const token = (await cookies()).get('odb_token')?.value;
  const res = await fetch(`${API}/ventas/${encodeURIComponent(ventaId)}/devolver`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(dto),
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
