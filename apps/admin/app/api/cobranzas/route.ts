import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API = process.env.API_URL ?? 'http://localhost:3001';

async function conToken(): Promise<Record<string, string>> {
  const token = (await cookies()).get('odb_token')?.value;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// Cobros a ingresar: el cajero los toma, el dueño los aprueba.
export async function GET(req: Request) {
  const estado = new URL(req.url).searchParams.get('estado') ?? 'pendiente';
  const res = await fetch(`${API}/cobranzas?estado=${encodeURIComponent(estado)}`, { headers: await conToken(), cache: 'no-store' });
  return NextResponse.json(await res.json(), { status: res.status });
}

export async function POST(req: Request) {
  const { accion, id, ...d } = await req.json().catch(() => ({}));
  const headers = { 'Content-Type': 'application/json', ...(await conToken()) };
  let ruta = '/cobranzas';
  if (accion === 'aprobar') ruta = `/cobranzas/${id}/aprobar`;
  else if (accion === 'rechazar') ruta = `/cobranzas/${id}/rechazar`;
  const res = await fetch(`${API}${ruta}`, { method: 'POST', headers, body: JSON.stringify(d) });
  return NextResponse.json(await res.json(), { status: res.status });
}
