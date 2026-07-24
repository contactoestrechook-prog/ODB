import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API = process.env.API_URL ?? 'http://localhost:3001';

export async function POST(req: Request) {
  const token = (await cookies()).get('odb_token')?.value;
  if (!token) return NextResponse.json({ message: 'Sesión expirada' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const res = await fetch(`${API}/auth/cambiar-clave`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body ?? {}),
  });
  const datos = await res.json();
  if (!res.ok) return NextResponse.json(datos, { status: res.status });

  // clave cambiada: token fresco y se baja la bandera que obligaba el cambio
  const respuesta = NextResponse.json({ ok: true });
  const seguro = process.env.NODE_ENV === 'production';
  if (datos.token) {
    respuesta.cookies.set('odb_token', datos.token, {
      httpOnly: true, sameSite: 'lax', secure: seguro, path: '/', maxAge: 60 * 60 * 12,
    });
  }
  respuesta.cookies.set('odb_cambiar', '', { path: '/', maxAge: 0 });
  return respuesta;
}
