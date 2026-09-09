import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API = process.env.API_URL ?? 'http://localhost:3001';

async function conToken(): Promise<Record<string, string>> {
  const token = (await cookies()).get('odb_token')?.value;
  return { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

// Fotos por código de barras (EZ Catalog): GET estado · POST {accion:'completar', limite} | {accion:'producto', sku}
export async function GET() {
  const res = await fetch(`${API}/catalogo/fotos-externas/estado`, { headers: await conToken(), cache: 'no-store' });
  return NextResponse.json(await res.json().catch(() => ({})), { status: res.status });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const headers = await conToken();
  const res = body?.accion === 'producto'
    ? await fetch(`${API}/catalogo/fotos-externas/producto/${encodeURIComponent(String(body.sku ?? ''))}`, { method: 'POST', headers })
    : await fetch(`${API}/catalogo/fotos-externas/completar`, { method: 'POST', headers, body: JSON.stringify({ limite: body.limite ?? 30 }) });
  return NextResponse.json(await res.json().catch(() => ({})), { status: res.status });
}
