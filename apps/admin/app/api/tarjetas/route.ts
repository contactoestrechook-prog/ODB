import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API = process.env.API_URL ?? 'http://localhost:3001';

// GET ?recurso=resumen|pagos&dias=30
export async function GET(req: Request) {
  const token = (await cookies()).get('odb_token')?.value;
  const sp = new URL(req.url).searchParams;
  const recurso = sp.get('recurso') === 'pagos' ? 'pagos' : 'resumen';
  const dias = sp.get('dias') ?? '30';
  const res = await fetch(`${API}/tarjetas/${recurso}?dias=${encodeURIComponent(dias)}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    cache: 'no-store',
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
