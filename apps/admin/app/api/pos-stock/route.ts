import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API = process.env.API_URL ?? 'http://localhost:3001';

// Consulta de stock por sucursal desde la caja (requiere sesión de staff).
export async function GET(req: Request) {
  const token = (await cookies()).get('odb_token')?.value;
  const q = new URL(req.url).searchParams.get('q') ?? '';
  const res = await fetch(`${API}/pos/stock?q=${encodeURIComponent(q)}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    cache: 'no-store',
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
