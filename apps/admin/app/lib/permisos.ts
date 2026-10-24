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
    '/pedido-proveedor', // armar el pedido desde el celular, con la lista de cada proveedor
    '/por-llegar', // qué mercadería llega y cuándo (fecha confirmada por el proveedor), 23/10/2026
    '/comparador', // proveedores y sus listas
    '/listas', // listas de precios de proveedor
    '/stock', // stock completo: existencias, ajustes, mermas, transferencias
    '/productos', // catálogo: alta de productos que llegan sin estar cargados
    '/precios', // verificador de precios del salón (equipo de mano con lector)
    '/conteo', // conteos de inventario
    '/fraccionar', // cargar el pozo y armar (el API ya se lo permite: hereda depósito), 21/10/2026
    '/trazabilidad', // cadena orden → recepción → factura → pago y sus documentos
    '/manual', // el manual lo abre cualquiera
    '/cambiar-clave',
  ],
  repartidor: ['/repartidor', '/manual', '/cambiar-clave'],
  // El menú tiene que ofrecer solo lo que el rol puede ABRIR de verdad. Antes,
  // un cajero veía Contable, Libro IVA, Estadísticas y Mercado Pago en el menú
  // y al entrar recibía "No pude consultar la API": el API ya lo bloqueaba
  // (403), así que la única consecuencia era una pantalla rota. Esto alinea el
  // menú con lo que el API permite; no quita ningún permiso que hoy tuvieran.
  cajero: [
    '/caja', // punto de venta
    '/ventas', // ventas del día
    '/pedidos', // pedidos para preparar y entregar
    '/deposito', // cola de preparación
    '/salida', // control de salida de Comprá Fácil
    '/precios', // verificador de precios
    '/productos', // catálogo (consulta)
    '/cheques', // cheques que recibe en el mostrador
    // «Mis entregas»: los envíos que lleva (21/10/2026: sin repartidores
    // cargados, un envío sale con alguien del local y tiene que ver la
    // dirección, el teléfono y qué cobrar). Solo ve los suyos.
    '/repartidor',
    '/fraccionar', // armar docenas y abrir maples en el local (el API ya se lo permitía), 21/10/2026
    '/manual', // el manual lo abre cualquiera
    '/cambiar-clave',
  ],
  // Comprador (21/10/2026): antes no figuraba y veía todo el menú, y en
  // Reparto, Eventos, Fraccionar, Pedidos o Depósito el API le daba 403
  // («No pude consultar la API», listas vacías sin explicación). Su lista va
  // alineada con los @Roles del API que lo incluyen: abastecimiento, compras,
  // proveedores y sus listas, documentos y catálogo.
  comprador: [
    '/compras', // órdenes de compra, sugerencias, deuda con proveedores
    '/pedido-proveedor', // armar el pedido desde el celular
    '/por-llegar', // qué mercadería llega y cuándo
    '/facturas-compra',
    '/mesa-compras', // abastecimiento
    '/comparador', // proveedores
    '/listas', // listas de precios de proveedor
    '/trazabilidad', // cadena orden → recepción → factura → pago
    '/analista',
    '/productos', // catálogo
    '/manual', // el manual lo abre cualquiera
    '/cambiar-clave',
  ],
  deposito: [
    '/deposito', // cola de preparación
    '/pedidos',
    '/recepcion', // recepción de mercadería con lector
    '/por-llegar', // qué mercadería llega y cuándo
    '/stock',
    '/conteo',
    '/fraccionar', // armar presentaciones y cargar el pozo (con PIN de supervisor arriba del tope), 21/10/2026
    '/precios',
    '/productos',
    '/repartidor', // «Mis entregas»: los envíos que lleva (ver cajero)
    '/manual', // el manual lo abre cualquiera
    '/cambiar-clave',
  ],
};

// A dónde entra cada rol al loguearse (el resto va a /inicio)
const LANDING_POR_ROL: Record<string, string> = {
  administrativo: '/facturas-compra',
  comprador: '/compras',
  repartidor: '/repartidor',
  cajero: '/caja',
  deposito: '/deposito',
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

// La cola de firmas la mira dirección. Un comprador que la viera solo se
// llevaría un 403 del API al entrar: el menú tiene que ofrecer lo que se puede
// abrir de verdad.
const RUTAS_DIRECCION = ['/aprobaciones', '/actividad'];

/**
 * Cargar repartidores (Reparto › Repartidores, gestion/repartidores en el API)
 * es de gerencia y dueño. Caja y depósito despachan desde Pedidos y Depósito
 * pero no abren Reparto: a ellos no se les ofrece el link (el panel los
 * devolvía a su inicio sin explicar nada y perdían el despacho a medio hacer).
 */
export function puedeCargarRepartidores(rol: string | null | undefined): boolean {
  return rol === 'dueno' || rol === 'gerente';
}

export function puedeVer(rol: string | null | undefined, pathname: string): boolean {
  if (RUTAS_SOLO_DUENO.some((r) => pathname === r || pathname.startsWith(r + '/'))) {
    return rol === 'dueno';
  }
  if (RUTAS_DIRECCION.some((r) => pathname === r || pathname.startsWith(r + '/'))) {
    return rol === 'dueno' || rol === 'gerente';
  }
  const permitidas = rutasPermitidas(rol);
  if (!permitidas) return true;
  return permitidas.some((r) => pathname === r || pathname.startsWith(r + '/'));
}

// El rol viaja en el JWT (cookie odb_token). Acá solo se LEE el payload para
// decidir qué mostrar; la verificación de firma la hace el API en cada llamada.
function payloadDe(token?: string | null): Record<string, unknown> | null {
  if (!token) return null;
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const json = typeof atob === 'function' ? atob(b64) : Buffer.from(b64, 'base64').toString('utf8');
    return JSON.parse(decodeURIComponent(escape(json)));
  } catch {
    return null;
  }
}

export function datosDesdeToken(token?: string | null): { sub: string | null; rol: string | null; nombre: string | null } {
  const datos = payloadDe(token);
  return {
    sub: typeof datos?.sub === 'string' ? datos.sub : null,
    rol: typeof datos?.rol === 'string' ? datos.rol : null,
    nombre: typeof datos?.nombre === 'string' ? datos.nombre : null,
  };
}

/** La sucursal asignada al usuario (usuarios.sucursal_id), si tiene. */
export function sucursalDesdeToken(token?: string | null): string | null {
  const datos = payloadDe(token);
  return typeof datos?.sucursalId === 'string' && datos.sucursalId ? datos.sucursalId : null;
}

export function rolDesdeToken(token?: string | null): string | null {
  return datosDesdeToken(token).rol;
}
