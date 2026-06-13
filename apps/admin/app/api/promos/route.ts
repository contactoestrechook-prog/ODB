import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API = process.env.API_URL ?? 'http://localhost:3001';

async function tok() {
  return (await cookies()).get('odb_token')?.value;
}

// GET ?accion=segun-stock|rendimiento
export async function GET(req: Request) {
  const t = await tok();
  const accion = new URL(req.url).searchParams.get('accion') ?? 'segun-stock';
  const res = await fetch(`${API}/promos/${accion}`, {
    headers: t ? { Authorization: `Bearer ${t}` } : {},
    cache: 'no-store',
  });
  return NextResponse.json(await res.json(), { status: res.status });
}

// POST { accion: 'sugerir'|'contexto'|'anuncio', ...datos }
export async function POST(req: Request) {
  const t = await tok();
  const { accion, ...datos } = await req.json().catch(() => ({}));
  const ruta = ['sugerir', 'contexto', 'anuncio'].includes(accion) ? accion : null;
  if (!ruta) return NextResponse.json({ message: 'Acción inválida' }, { status: 400 });
  const res = await fetch(`${API}/promos/${ruta}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) },
    body: JSON.stringify(datos),
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
