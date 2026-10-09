import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API = process.env.API_URL ?? 'http://localhost:3001';

// Quién hizo qué (6/10/2026): pasa los filtros tal cual a la API.
export async function GET(req: Request) {
  const token = (await cookies()).get('odb_token')?.value;
  if (!token) return NextResponse.json({ message: 'Volvé a entrar al sistema' }, { status: 401 });
  const q = new URL(req.url).searchParams;
  const params = new URLSearchParams();
  for (const k of ['desde', 'hasta', 'usuario', 'area']) { const v = q.get(k); if (v) params.set(k, v); }
  const res = await fetch(`${API}/actividad?${params}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
  const datos = await res.json().catch(() => ({ message: 'La API no respondió bien' }));
  return NextResponse.json(datos, { status: res.status });
}
