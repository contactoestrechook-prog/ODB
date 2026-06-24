import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API = process.env.API_URL ?? 'http://localhost:3001';

async function tok(): Promise<Record<string, string>> {
  const t = (await cookies()).get('odb_token')?.value;
  return t ? { Authorization: `Bearer ${t}` } : {};
}

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const recurso = sp.get('recurso') ?? 'resumen';
  let ruta = '/envases/resumen';
  if (recurso === 'saldos') ruta = '/envases/saldos';
  else if (recurso === 'tipos') ruta = '/envases/tipos';
  else if (recurso === 'cliente') ruta = `/envases/cliente/${sp.get('id')}`;
  else if (recurso === 'buscarCliente') ruta = `/buscar?q=${encodeURIComponent(sp.get('q') ?? '')}`;
  const res = await fetch(`${API}${ruta}`, { headers: await tok(), cache: 'no-store' });
  const data = await res.json();
  if (recurso === 'buscarCliente') return NextResponse.json(data?.clientes ?? [], { status: res.status });
  return NextResponse.json(data, { status: res.status });
}

export async function POST(req: Request) {
  const { accion, ...d } = await req.json().catch(() => ({} as any));
  const ruta = accion === 'tipo' ? '/envases/tipos' : '/envases/movimiento';
  const res = await fetch(`${API}${ruta}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await tok()) },
    body: JSON.stringify(d),
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
