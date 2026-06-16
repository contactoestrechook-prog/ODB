import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API = process.env.API_URL ?? 'http://localhost:3001';

async function tok(): Promise<Record<string, string>> {
  const token = (await cookies()).get('odb_token')?.value;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const recurso = sp.get('recurso') ?? 'resumen';
  let ruta: string;
  if (recurso === 'resumen') ruta = '/conciliacion/resumen';
  else if (recurso === 'comisiones') ruta = '/conciliacion/comisiones';
  else {
    const qs = new URLSearchParams();
    for (const k of ['estado', 'medio', 'dias']) {
      const v = sp.get(k);
      if (v) qs.set(k, v);
    }
    ruta = `/conciliacion${qs.toString() ? '?' + qs.toString() : ''}`;
  }
  const res = await fetch(`${API}${ruta}`, { headers: await tok(), cache: 'no-store' });
  return NextResponse.json(await res.json(), { status: res.status });
}

// POST { accion: 'mp' | 'lote' | 'acreditar', ...datos }
export async function POST(req: Request) {
  const headers = { 'Content-Type': 'application/json', ...(await tok()) };
  const { accion, ...d } = await req.json().catch(() => ({}));
  let ruta: string | null = null;
  if (accion === 'mp') ruta = '/conciliacion/mp';
  else if (accion === 'lote') ruta = '/conciliacion/lote';
  else if (accion === 'acreditar' && d.id) ruta = `/conciliacion/${d.id}/acreditar`;
  if (!ruta) return NextResponse.json({ message: 'Acción inválida' }, { status: 400 });
  const res = await fetch(`${API}${ruta}`, { method: 'POST', headers, body: JSON.stringify(d) });
  return NextResponse.json(await res.json(), { status: res.status });
}

export async function PATCH(req: Request) {
  const headers = { 'Content-Type': 'application/json', ...(await tok()) };
  const body = await req.json().catch(() => ({}));
  const res = await fetch(`${API}/conciliacion/comisiones`, { method: 'PATCH', headers, body: JSON.stringify(body) });
  return NextResponse.json(await res.json(), { status: res.status });
}
