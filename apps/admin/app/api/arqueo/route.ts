import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

// Arqueo de stock (24/10/2026): reenvía al API /stock/arqueos/<ruta>. Solo
// pasan las rutas conocidas (nunca una dirección armada por el navegador).
const API = process.env.API_URL ?? 'http://localhost:3001';
const U = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const GET_OK = new RegExp(`^(|opciones|${U}/(contar|identificar|revision))$`, 'i');
const POST_OK = new RegExp(`^(|${U}/(registros|registros/${U}/anular|no-encontrado|a-revision|reabrir|reconteo|aplicar|descartar))$`, 'i');

async function reenviar(ruta: string, init: RequestInit = {}, query = '') {
  const token = (await cookies()).get('odb_token')?.value;
  const res = await fetch(`${API}/stock/arqueos${ruta ? `/${ruta}` : ''}${query}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    cache: 'no-store',
  });
  if (!res.ok) console.warn('[api/arqueo]', init.method ?? 'GET', ruta, '→', res.status);
  return NextResponse.json(await res.json().catch(() => ({})), { status: res.status });
}

// GET ?ruta=<id>/contar | <id>/identificar&q=… | <id>/revision | opciones | (vacío: lista)
export async function GET(req: Request) {
  const url = new URL(req.url);
  const ruta = url.searchParams.get('ruta') ?? '';
  if (!GET_OK.test(ruta)) return NextResponse.json({ message: 'Ruta inválida' }, { status: 400 });
  const q = url.searchParams.get('q');
  return reenviar(ruta, {}, q != null ? `?q=${encodeURIComponent(q)}` : '');
}

// POST { ruta, ...datos }
export async function POST(req: Request) {
  const { ruta = '', ...datos } = await req.json().catch(() => ({}));
  if (typeof ruta !== 'string' || !POST_OK.test(ruta)) return NextResponse.json({ message: 'Ruta inválida' }, { status: 400 });
  return reenviar(ruta, { method: 'POST', body: JSON.stringify(datos) });
}
