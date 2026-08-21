// Qué partes del panel ve cada rol. La seguridad real está en el API (@Roles);
// esto es la capa de experiencia: que un usuario de backoffice no vea Caja,
// Ventas ni Dirección en el menú ni pueda abrirlas por URL.
//
// Hoy solo "administrativo" y "repartidor" están restringidos (backoffice: facturas de compra,
// remitos y recepción de mercadería, compras y proveedores). Los demás roles
// siguen viendo todo el menú como hasta ahora: restringirlos es una decisión
// del dueño, no un efecto colateral.

export type Rol = 'dueno' | 'gerente' | 'comprador' | 'cajero' | 'deposito' | 'administrativo' | 'repartidor' | string;

const RUTAS_POR_ROL: Record<string, string[]> = {
  administrativo: [
    '/facturas-compra', // carga y consulta de facturas de proveedor
    '/recepcion', // remitos y recepción de mercadería
    '/compras', // órdenes de compra, deuda con proveedores
    '/comparador', // proveedores y sus listas
    '/listas', // listas de precios de proveedor
    '/stock', // stock completo: existencias, ajustes, mermas, transferencias
    '/productos', // catálogo: alta de productos que llegan sin estar cargados
    '/precios', // verificador de precios del salón (equipo de mano con lector)
    '/conteo', // conteos de inventario
    '/cambiar-clave',
  ],
  repartidor: ['/repartidor', '/cambiar-clave'],
};

// A dónde entra cada rol al loguearse (el resto va a /inicio)
const LANDING_POR_ROL: Record<string, string> = {
  administrativo: '/facturas-compra',
  repartidor: '/repartidor',
};

export function rutasPermitidas(rol?: string | null): string[] | null {
  if (!rol) return null;
  return RUTAS_POR_ROL[rol] ?? null; // null = todas
}

export function landingDe(rol?: string | null): string {
  return (rol && LANDING_POR_ROL[rol]) || '/inicio';
}

// Rutas reservadas a un rol puntual, se tenga o no menú restringido.
// RESPONDE (el monitor del bot de WhatsApp) es de los dueños: ahí están las
// conversaciones completas de los clientes.
const RUTAS_SOLO_DUENO = ['/whatsapp', '/responde'];

export function puedeVer(rol: string | null | undefined, pathname: string): boolean {
  if (RUTAS_SOLO_DUENO.some((r) => pathname === r || pathname.startsWith(r + '/'))) {
    return rol === 'dueno';
  }
  const permitidas = rutasPermitidas(rol);
  if (!permitidas) return true;
  return permitidas.some((r) => pathname === r || pathname.startsWith(r + '/'));
}

// El rol viaja en el JWT (cookie odb_token). Acá solo se LEE el payload para
// decidir qué mostrar; la verificación de firma la hace el API en cada llamada.
export function datosDesdeToken(token?: string | null): { sub: string | null; rol: string | null; nombre: string | null } {
  if (!token) return { sub: null, rol: null, nombre: null };
  try {
    const payload = token.split('.')[1];
    if (!payload) return { sub: null, rol: null, nombre: null };
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const json = typeof atob === 'function' ? atob(b64) : Buffer.from(b64, 'base64').toString('utf8');
    const datos = JSON.parse(decodeURIComponent(escape(json)));
    return {
      sub: typeof datos?.sub === 'string' ? datos.sub : null,
      rol: typeof datos?.rol === 'string' ? datos.rol : null,
      nombre: typeof datos?.nombre === 'string' ? datos.nombre : null,
    };
  } catch {
    return { sub: null, rol: null, nombre: null };
  }
}

export function rolDesdeToken(token?: string | null): string | null {
  return datosDesdeToken(token).rol;
}
