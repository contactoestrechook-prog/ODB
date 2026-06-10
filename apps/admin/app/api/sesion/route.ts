import { NextResponse } from 'next/server';

const API = process.env.API_URL ?? 'http://localhost:3001';

export async function POST(req: Request) {
  const body = await req.json();
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const datos = await res.json();
  if (!res.ok) return NextResponse.json(datos, { status: res.status });

  const respuesta = NextResponse.json({ usuario: datos.usuario });
  respuesta.cookies.set('odb_token', datos.token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 12,
  });
  return respuesta;
}
