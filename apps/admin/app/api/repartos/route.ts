import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API = process.env.API_URL ?? 'http://localhost:3001';
async function tok(): Promise<Record<string, string>> {
  const t = (await cookies()).get('odb_token')?.value;
  return t ? { Authorization: `Bearer ${t}` } : {};
}

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const recurso = sp.get('recurso') ?? 'lista';
  let ruta = '/repartos';
  if (recurso === 'flota') ruta = '/repartos/flota';
  else if (recurso === 'choferes') ruta = '/repartos/choferes';
  else if (recurso === 'clientesZona') ruta = `/repartos/clientes-zona?zona=${encodeURIComponent(sp.get('zona') ?? '')}`;
  else if (recurso === 'detalle') ruta = `/repartos/${sp.get('id')}`;
  else if (recurso === 'lista') ruta = `/repartos?dias=${sp.get('dias') ?? 7}`;
  const res = await fetch(`${API}${ruta}`, { headers: await tok(), cache: 'no-store' });
  return NextResponse.json(await res.json(), { status: res.status });
}

export async function POST(req: Request) {
  const { accion, ...d } = await req.json().catch(() => ({} as any));
  let ruta = '/repartos';
  let body: any = d;
  if (accion === 'posicion') ruta = '/repartos/posicion';
  else if (accion === 'parada') ruta = `/repartos/${d.id}/paradas`;
  else if (accion === 'traerZona') ruta = `/repartos/${d.id}/traer-zona`;
  else if (accion === 'marcar') ruta = `/repartos/parada/${d.pid}`;
  else if (accion === 'estado') ruta = `/repartos/${d.id}/estado`;
  // 'crear' → POST /repartos (default)
  const res = await fetch(`${API}${ruta}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await tok()) },
    body: JSON.stringify(body),
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
