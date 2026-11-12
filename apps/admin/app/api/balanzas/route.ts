import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API = process.env.API_URL ?? 'http://localhost:3001';

async function token() {
  return (await cookies()).get('odb_token')?.value;
}

// Balanzas (11/11/2026): GET la lista · GET ?archivo=completo|cambios el CSV para iTegra
export async function GET(req: Request) {
  const t = await token();
  const archivo = new URL(req.url).searchParams.get('archivo');
  const auth: Record<string, string> = t ? { Authorization: `Bearer ${t}` } : {};
  if (archivo) {
    const modo = archivo === 'cambios' ? 'cambios' : 'completo';
    const res = await fetch(`${API}/balanzas/itegra?modo=${modo}`, { headers: auth, cache: 'no-store' });
    if (!res.ok) return NextResponse.json(await res.json().catch(() => ({ message: 'La API no respondió' })), { status: res.status });
    return new Response(await res.arrayBuffer(), {
      headers: {
        'Content-Type': res.headers.get('Content-Type') ?? 'text/csv',
        'Content-Disposition': res.headers.get('Content-Disposition') ?? 'attachment; filename="odb-balanzas.csv"',
        'X-Cantidad': res.headers.get('X-Cantidad') ?? '',
      },
    });
  }
  const res = await fetch(`${API}/balanzas/lista`, { headers: auth, cache: 'no-store' });
  return NextResponse.json(await res.json().catch(() => ({ message: 'La API no respondió' })), { status: res.status });
}

// Sumar o sacar un producto por unidad: { sku, enBalanza }
export async function POST(req: Request) {
  const t = await token();
  const b = await req.json().catch(() => ({}));
  const res = await fetch(`${API}/balanzas/productos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) },
    body: JSON.stringify({ sku: b?.sku, enBalanza: b?.enBalanza !== false }),
    cache: 'no-store',
  });
  return NextResponse.json(await res.json().catch(() => ({})), { status: res.status });
}
