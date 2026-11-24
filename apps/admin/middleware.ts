import { NextRequest, NextResponse } from 'next/server';
import { landingDe, puedeVer, rolesDesdeToken } from './app/lib/permisos';
import { COOKIES_DE_SESION, RUTAS_QUE_ESCRIBEN_LA_SESION, SESION_MAX_AGE } from './lib/sesion';

// La sesión no vence (24/11/2026): cada pantalla y cada consulta del panel le
// renueva la cookie, así nunca llega a su fecha (ver lib/sesion.ts). Las
// sesiones abiertas antes del cambio (cookie de 12 h) también se renuevan.
function renovar(req: NextRequest, res: NextResponse): NextResponse {
  if (RUTAS_QUE_ESCRIBEN_LA_SESION.includes(req.nextUrl.pathname)) return res;
  const seguro = process.env.NODE_ENV === 'production';
  for (const c of COOKIES_DE_SESION) {
    const valor = req.cookies.get(c.nombre)?.value;
    if (valor) {
      res.cookies.set(c.nombre, valor, { httpOnly: c.httpOnly, sameSite: 'lax', secure: seguro, path: '/', maxAge: SESION_MAX_AGE });
    }
  }
  return res;
}

export function middleware(req: NextRequest) {
  return renovar(req, decidir(req));
}

function decidir(req: NextRequest): NextResponse {
  const token = req.cookies.get('odb_token');
  const debeCambiar = req.cookies.get('odb_cambiar')?.value === '1';
  const { pathname } = req.nextUrl;
  // las consultas del panel (/api/…) solo pasan por acá para renovar la sesión:
  // cada una se cuida sola (sin token, la API contesta 401)
  if (pathname.startsWith('/api/')) return NextResponse.next();
  // Pantallas de recuperación de clave: quien las usa, justamente, NO puede
  // entrar. Si el middleware las mandara al login, el circuito no serviría.
  const publicas = ['/login', '/olvide-clave', '/restablecer'];
  if (!token && !publicas.includes(pathname)) {
    return NextResponse.redirect(new URL('/login', req.url));
  }
  if (token && pathname === '/login') {
    return NextResponse.redirect(new URL('/inicio', req.url));
  }
  // con sesión abierta, recuperar la clave no tiene sentido: va a cambiarla
  if (token && (pathname === '/olvide-clave' || pathname === '/restablecer')) {
    return NextResponse.redirect(new URL('/cambiar-clave', req.url));
  }
  // clave temporal: no puede usar el panel hasta cambiarla (el cambio voluntario
  // a /cambiar-clave sí se permite siempre que esté logueado)
  if (token && debeCambiar && pathname !== '/cambiar-clave') {
    return NextResponse.redirect(new URL('/cambiar-clave', req.url));
  }
  // roles restringidos (backoffice): fuera de sus pantallas, a su inicio
  if (token) {
    // todos sus roles (19/11/2026): ve la suma, entra por el principal
    const roles = rolesDesdeToken(token.value);
    if (!puedeVer(roles, pathname)) {
      return NextResponse.redirect(new URL(landingDe(roles), req.url));
    }
  }
  return NextResponse.next();
}

export const config = {
  // webmanifest y sw.js: el navegador los pide SIN cookies para decidir si el
  // sitio es instalable; si el middleware los manda a /login, no hay app.
  // comandas/: el acceso directo de las PC con impresora (lo baja depósito, que
  // no tiene esa ruta entre sus pantallas; no lleva nada privado)
  // api/ entra (24/11/2026) solo para renovar la sesión: la caja que queda todo
  // el día en una misma pantalla consulta /api/… sin cambiar de página
  matcher: ['/((?!_next|favicon.ico|sw.js|comandas/|.*\\.(?:png|jpg|jpeg|svg|gif|webp|ico|webmanifest)$).*)'],
};
