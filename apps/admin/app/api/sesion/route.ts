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
  const seguro = process.env.NODE_ENV === 'production';
  respuesta.cookies.set('odb_token', datos.token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: seguro,
    path: '/',
    maxAge: 60 * 60 * 12,
  });
  // email visible para JS (no es secreto para su propio dueño): lo necesita el
  // formulario de cambio de clave como campo username, para que el gestor de
  // contraseñas del navegador ACTUALICE la clave guardada en vez de quedarse
  // con la vieja (que después autocompleta en el login y parece "clave mal").
  respuesta.cookies.set('odb_usuario', String(body?.email ?? ''), {
    sameSite: 'lax',
    secure: seguro,
    path: '/',
    maxAge: 60 * 60 * 12,
  });
  // bandera para que el middleware obligue a cambiar la clave temporal
  if (datos.usuario?.debeCambiarClave) {
    respuesta.cookies.set('odb_cambiar', '1', { httpOnly: true, sameSite: 'lax', secure: seguro, path: '/', maxAge: 60 * 60 * 12 });
  } else {
    respuesta.cookies.set('odb_cambiar', '', { path: '/', maxAge: 0 });
  }
  return respuesta;
}
