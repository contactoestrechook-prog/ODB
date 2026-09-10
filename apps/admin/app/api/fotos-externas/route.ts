import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API = process.env.API_URL ?? 'http://localhost:3001';

async function conToken(): Promise<Record<string, string>> {
  const token = (await cookies()).get('odb_token')?.value;
  return { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

// Fotos por código de barras (EZ Catalog):
//   GET  ?que=dudosas → las que hay que mirar a mano; si no, el estado
//   POST {accion:'completar'|'producto'|'dudosa'}
export async function GET(req: Request) {
  const que = new URL(req.url).searchParams.get('que');
  const camino = que === 'dudosas' ? 'dudosas' : que === 'calidad' ? 'calidad' : que === 'sacadas' ? 'calidad/sacadas' : 'estado';
  const res = await fetch(`${API}/catalogo/fotos-externas/${camino}`, { headers: await conToken(), cache: 'no-store' });
  return NextResponse.json(await res.json().catch(() => ({})), { status: res.status });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const headers = await conToken();
  const res = body?.accion === 'producto'
    ? await fetch(`${API}/catalogo/fotos-externas/producto/${encodeURIComponent(String(body.sku ?? ''))}`, { method: 'POST', headers })
    : body?.accion === 'calidad'
    ? await fetch(`${API}/catalogo/fotos-externas/calidad/revisar`, { method: 'POST', headers, body: JSON.stringify({ limite: body.limite ?? 40 }) })
    : body?.accion === 'dudosa'
    ? await fetch(`${API}/catalogo/fotos-externas/dudosa/${encodeURIComponent(String(body.id ?? ''))}`, { method: 'POST', headers, body: JSON.stringify({ aceptar: !!body.aceptar }) })
    : await fetch(`${API}/catalogo/fotos-externas/completar`, { method: 'POST', headers, body: JSON.stringify({ limite: body.limite ?? 30 }) });
  return NextResponse.json(await res.json().catch(() => ({})), { status: res.status });
}
