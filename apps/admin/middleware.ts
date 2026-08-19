import { NextRequest, NextResponse } from 'next/server';
import { landingDe, puedeVer, rolDesdeToken } from './app/lib/permisos';

export function middleware(req: NextRequest) {
  const token = req.cookies.get('odb_token');
  const debeCambiar = req.cookies.get('odb_cambiar')?.value === '1';
  const { pathname } = req.nextUrl;
  if (!token && pathname !== '/login') {
    return NextResponse.redirect(new URL('/login', req.url));
  }
  if (token && pathname === '/login') {
    return NextResponse.redirect(new URL('/inicio', req.url));
  }
  // clave temporal: no puede usar el panel hasta cambiarla (el cambio voluntario
  // a /cambiar-clave sí se permite siempre que esté logueado)
  if (token && debeCambiar && pathname !== '/cambiar-clave') {
    return NextResponse.redirect(new URL('/cambiar-clave', req.url));
  }
  // roles restringidos (backoffice): fuera de sus pantallas, a su inicio
  if (token) {
    const rol = rolDesdeToken(token.value);
    if (!puedeVer(rol, pathname)) {
      return NextResponse.redirect(new URL(landingDe(rol), req.url));
    }
  }
  return NextResponse.next();
}

export const config = {
  // webmanifest y sw.js: el navegador los pide SIN cookies para decidir si el
  // sitio es instalable; si el middleware los manda a /login, no hay app.
  matcher: ['/((?!_next|favicon.ico|sw.js|api/|.*\\.(?:png|jpg|jpeg|svg|gif|webp|ico|webmanifest)$).*)'],
};
