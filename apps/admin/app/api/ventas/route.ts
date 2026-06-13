import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API = process.env.API_URL ?? 'http://localhost:3001';

// GET con filtros: estado, sucursalId, medioPago, dias, buscar, limite
export async function GET(req: Request) {
  const token = (await cookies()).get('odb_token')?.value;
  const qs = new URL(req.url).search;
  const res = await fetch(`${API}/ventas${qs}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    cache: 'no-store',
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
