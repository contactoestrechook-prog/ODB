import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API = process.env.API_URL ?? 'http://localhost:3001';

async function tok(): Promise<Record<string, string>> {
  const t = (await cookies()).get('odb_token')?.value;
  return t ? { Authorization: `Bearer ${t}` } : {};
}

const MAP: Record<string, string> = {
  directorio: '/comparador/directorio',
  stats: '/comparador/stats',
  proveedores: '/comparador/proveedores',
  comparacion: '/comparador',
};

export async function GET(req: Request) {
  const recurso = new URL(req.url).searchParams.get('recurso') ?? 'comparacion';
  const res = await fetch(`${API}${MAP[recurso] ?? '/comparador'}`, { headers: await tok(), cache: 'no-store' });
  return NextResponse.json(await res.json(), { status: res.status });
}

// Cargar lista de proveedor: accion 'analizar' (preview) o 'aplicar'.
export async function POST(req: Request) {
  const { accion, ...d } = await req.json().catch(() => ({} as any));
  const ruta = accion === 'aplicar' ? '/comparador/aplicar-lista'
    : accion === 'interpretar' ? '/comparador/interpretar-aclaracion'
    : '/comparador/analizar-lista';
  const res = await fetch(`${API}${ruta}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await tok()) },
    body: JSON.stringify(d),
  });
  return NextResponse.json(await res.json(), { status: res.status });
}

export async function PATCH(req: Request) {
  const headers = { 'Content-Type': 'application/json', ...(await tok()) };
  const { id, ...d } = await req.json().catch(() => ({}));
  const res = await fetch(`${API}/comparador/proveedor/${id}`, { method: 'PATCH', headers, body: JSON.stringify(d) });
  return NextResponse.json(await res.json(), { status: res.status });
}
