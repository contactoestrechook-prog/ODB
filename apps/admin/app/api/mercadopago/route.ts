import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API = process.env.API_URL ?? 'http://localhost:3001';

async function auth(): Promise<Record<string, string>> {
  const token = (await cookies()).get('odb_token')?.value;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// GET ?recurso=estado|resumen|pagos|mensual|dias|liberaciones|pagos-dia&…
// Solo pasan estos recursos y estos parámetros; la seguridad real está en el API (@Roles).
const RECURSOS = ['estado', 'resumen', 'pagos', 'mensual', 'dias', 'liberaciones', 'pagos-dia', 'movimientos', 'movimientos-dia'];
const PARAMS = ['dias', 'cuenta', 'meses', 'desde', 'hasta', 'dia', 'tipo', 'por'];
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const recurso = RECURSOS.includes(sp.get('recurso') ?? '') ? sp.get('recurso') : 'resumen';
  const q = new URLSearchParams();
  for (const k of PARAMS) { const v = sp.get(k); if (v) q.set(k, v); }
  if (!q.has('dias') && (recurso === 'resumen' || recurso === 'pagos')) q.set('dias', '30');
  const res = await fetch(`${API}/mercadopago/${recurso}?${q}`, { headers: await auth(), cache: 'no-store' });
  return NextResponse.json(await res.json().catch(() => ({})), { status: res.status });
}

// POST { accion: 'importar'|'link', ... }
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const accion = body?.accion === 'link' ? 'link' : 'importar';
  const res = await fetch(`${API}/mercadopago/${accion}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await auth()) },
    body: JSON.stringify(body ?? {}),
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
