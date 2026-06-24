import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API = process.env.API_URL ?? 'http://localhost:3001';

async function token() {
  return (await cookies()).get('odb_token')?.value;
}

export async function GET() {
  const t = await token();
  const res = await fetch(`${API}/tiendanube/estado`, { headers: t ? { Authorization: `Bearer ${t}` } : {}, cache: 'no-store' });
  return NextResponse.json(await res.json(), { status: res.status });
}

// POST { accion: 'sync' | 'importar', limite? }
export async function POST(req: Request) {
  const t = await token();
  const { accion, ...d } = await req.json().catch(() => ({}));
  const ruta = accion === 'sync' ? '/tiendanube/sync-catalogo' : accion === 'importar' ? '/tiendanube/importar-pedidos' : null;
  if (!ruta) return NextResponse.json({ message: 'Acción inválida' }, { status: 400 });
  const res = await fetch(`${API}${ruta}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) },
    body: JSON.stringify(d),
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
