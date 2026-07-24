import { NextRequest, NextResponse } from 'next/server';

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
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next|favicon.ico|api/|.*\\.(?:png|jpg|jpeg|svg|gif|webp|ico)$).*)'],
};
