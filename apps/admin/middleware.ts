import { NextRequest, NextResponse } from 'next/server';
import { landingDe, puedeVer, rolesDesdeToken } from './app/lib/permisos';
import { abiertoDesdeAfuera } from './app/lib/rutas';
import { COOKIE_SESION_AL_DIA, COOKIES_DE_SESION, REVISAR_SESION_MS, RUTAS_QUE_ESCRIBEN_LA_SESION, SESION_MAX_AGE } from './lib/sesion';

const API = process.env.API_URL ?? 'http://localhost:3001';

// LOS PERMISOS DE HOY (27/11/2026): una vez por minuto, el token se cambia por uno con
// los roles, el nombre y la sucursal de hoy (lib/sesion.ts). Si la API no contesta,
// se sigue con el que había y se vuelve a probar al minuto.
async function sesionAlDia(req: NextRequest): Promise<{ revisada: boolean; token: string | null }> {
  const token = req.cookies.get('odb_token')?.value;
  if (!token || RUTAS_QUE_ESCRIBEN_LA_SESION.includes(req.nextUrl.pathname)) return { revisada: false, token: null };
  const ultima = Number(req.cookies.get(COOKIE_SESION_AL_DIA)?.value ?? 0);
  if (Date.now() - ultima < REVISAR_SESION_MS) return { revisada: false, token: null };
  try {
    const r = await fetch(`${API}/auth/sesion-al-dia`, {
      headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: AbortSignal.timeout(2_500),
    });
    if (!r.ok) return { revisada: true, token: null };
    const datos = await r.json().catch(() => null);
    return { revisada: true, token: typeof datos?.token === 'string' && datos.token ? datos.token : null };
  } catch {
    return { revisada: true, token: null };
  }
}

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

export async function middleware(req: NextRequest) {
  const alDia = await sesionAlDia(req);
  // el token nuevo vale ya en este pedido: para decidir la pantalla y para lo que
  // la página lea de las cookies (va en los encabezados que siguen, ver seguir())
  if (alDia.token) req.cookies.set('odb_token', alDia.token);
  const res = renovar(req, decidir(req));
  if (alDia.revisada) {
    res.cookies.set(COOKIE_SESION_AL_DIA, String(Date.now()), {
      httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: SESION_MAX_AGE,
    });
  }
  return res;
}

// sigue de largo con los encabezados del pedido (con el token al día, si cambió)
const seguir = (req: NextRequest) => NextResponse.next({ request: { headers: req.headers } });

function decidir(req: NextRequest): NextResponse {
  const token = req.cookies.get('odb_token');
  const debeCambiar = req.cookies.get('odb_cambiar')?.value === '1';
  const { pathname } = req.nextUrl;
  // las consultas del panel (/api/…) solo pasan por acá para renovar la sesión:
  // cada una se cuida sola (sin token, la API contesta 401)
  if (pathname.startsWith('/api/')) return seguir(req);
  // Pantallas de recuperación de clave: quien las usa, justamente, NO puede
  // entrar. Si el middleware las mandara al login, el circuito no serviría.
  const publicas = ['/login', '/olvide-clave', '/restablecer'];
  if (!token && !publicas.includes(pathname)) {
    return NextResponse.redirect(new URL('/login', req.url));
  }
  if (token && pathname === '/login') {
    return NextResponse.redirect(new URL('/inicio', req.url));
  }
  // con sesión abierta, recuperar la clave no tiene sentido: ya está adentro, va a su
  // pantalla de trabajo (27/11/2026). Antes iba a «Cambiar mi contraseña», y quien entraba
  // con el enlace de WhatsApp de «Recuperar contraseña» caía ahí cada vez (Camila Molina).
  if (token && (pathname === '/olvide-clave' || pathname === '/restablecer')) {
    return NextResponse.redirect(new URL(debeCambiar ? '/cambiar-clave' : landingDe(rolesDesdeToken(token.value)), req.url));
  }
  // clave temporal: no puede usar el panel hasta cambiarla (el cambio voluntario
  // a /cambiar-clave sí se permite siempre que esté logueado)
  if (token && debeCambiar && pathname !== '/cambiar-clave') {
    return NextResponse.redirect(new URL('/cambiar-clave', req.url));
  }
  // el cambio voluntario es desde el menú: abrir el panel DESDE AFUERA en «Cambiar mi
  // contraseña» (un acceso directo guardado el día que se la hicieron cambiar) lleva a su
  // pantalla de trabajo (27/11/2026)
  if (token && !debeCambiar && pathname === '/cambiar-clave' && abiertoDesdeAfuera(req.headers)) {
    return NextResponse.redirect(new URL(landingDe(rolesDesdeToken(token.value)), req.url));
  }
  // roles restringidos (backoffice): fuera de sus pantallas, a su inicio
  if (token) {
    // todos sus roles (19/11/2026): ve la suma, entra por el principal
    const roles = rolesDesdeToken(token.value);
    if (!puedeVer(roles, pathname)) {
      return NextResponse.redirect(new URL(landingDe(roles), req.url));
    }
  }
  return seguir(req);
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
