import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API = process.env.API_URL ?? 'http://localhost:3001';

// Facturación › tablero (17/11/2026): pasa la consulta tal cual a la API
export async function GET(req: Request) {
  const t = (await cookies()).get('odb_token')?.value;
  const qs = new URL(req.url).search;
  const res = await fetch(`${API}/facturacion/tablero${qs}`, {
    headers: t ? { Authorization: `Bearer ${t}` } : {},
    cache: 'no-store',
  }).catch(() => null);
  if (!res) return NextResponse.json({ message: 'Sin conexión con la API' }, { status: 502 });
  return NextResponse.json(await res.json().catch(() => ({})), { status: res.status });
}
