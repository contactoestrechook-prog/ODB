import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API = process.env.API_URL ?? 'http://localhost:3001';

async function token() {
  return (await cookies()).get('odb_token')?.value;
}

// GET ?recurso=resumen         → tablero
// GET ?tipo=&estado=&buscar=    → listado filtrado
export async function GET(req: Request) {
  const t = await token();
  const sp = new URL(req.url).searchParams;
  const ruta = sp.get('recurso') === 'resumen' ? '/cheques/resumen' : `/cheques${new URL(req.url).search}`;
  const res = await fetch(`${API}${ruta}`, {
    headers: t ? { Authorization: `Bearer ${t}` } : {},
    cache: 'no-store',
  });
  return NextResponse.json(await res.json(), { status: res.status });
}

// POST { accion, id?, ...datos }
export async function POST(req: Request) {
  const t = await token();
  const { accion, id, ...d } = await req.json().catch(() => ({}));
  const ruta =
    accion === 'crear' ? '/cheques'
    : accion === 'depositar' ? `/cheques/${id}/depositar`
    : accion === 'acreditar' ? `/cheques/${id}/acreditar`
    : accion === 'rechazar' ? `/cheques/${id}/rechazar`
    : accion === 'aplicar' ? `/cheques/${id}/aplicar`
    : accion === 'debitar' ? `/cheques/${id}/debitar`
    : accion === 'anular' ? `/cheques/${id}/anular`
    : null;
  if (!ruta) return NextResponse.json({ message: 'Acción inválida' }, { status: 400 });
  const res = await fetch(`${API}${ruta}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) },
    body: JSON.stringify(d),
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
