import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API = process.env.API_URL ?? 'http://localhost:3001';

// Búsqueda liviana del POS (same-origin, sin CORS) — código de barras + nombre.
export async function GET(req: Request) {
  const token = (await cookies()).get('odb_token')?.value;
  const sp = new URL(req.url).searchParams;
  const q = sp.get('q') ?? '';
  const sucursal = sp.get('sucursal') ?? '';
  const res = await fetch(`${API}/pos/buscar?q=${encodeURIComponent(q)}&sucursal=${encodeURIComponent(sucursal)}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    cache: 'no-store',
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
