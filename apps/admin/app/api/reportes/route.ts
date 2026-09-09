import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API = process.env.API_URL ?? 'http://localhost:3001';

async function conToken(): Promise<Record<string, string>> {
  const token = (await cookies()).get('odb_token')?.value;
  return { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

// "Esto está mal": crear un reporte (POST) · listar (GET ?estado=pendientes) · resolver (POST {accion:'resolver', id, respuesta, estado})
export async function GET(req: Request) {
  const estado = new URL(req.url).searchParams.get('estado') ?? '';
  const res = await fetch(`${API}/reportes${estado ? `?estado=${encodeURIComponent(estado)}` : ''}`, { headers: await conToken(), cache: 'no-store' });
  return NextResponse.json(await res.json().catch(() => []), { status: res.status });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const headers = await conToken();
  const res = body?.accion === 'resolver'
    ? await fetch(`${API}/reportes/${encodeURIComponent(String(body.id ?? ''))}/resolver`, { method: 'POST', headers, body: JSON.stringify({ respuesta: body.respuesta, estado: body.estado }) })
    : await fetch(`${API}/reportes`, { method: 'POST', headers, body: JSON.stringify(body) });
  return NextResponse.json(await res.json().catch(() => ({})), { status: res.status });
}
