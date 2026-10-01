// Rutas que no son "del panel". Una sola lista para todos los flotantes
// ("Esto está mal", el cartel de instalar la app): antes cada uno tenía la
// suya y las dos estaban incompletas (el cartel tapaba /olvide-clave y
// /restablecer).

/** Pantallas de acceso: se usan sin sesión o para cambiar la clave. */
export const RUTAS_ACCESO = ['/login', '/olvide-clave', '/restablecer', '/cambiar-clave'] as const;

/** Pantallas completas que no son del panel (RESPONDE embebido a pantalla completa). */
export const RUTAS_PANTALLA_COMPLETA = ['/whatsapp'] as const;

const coincide = (ruta: string, base: string) => ruta === base || ruta.startsWith(base + '/');

/** ¿Es una pantalla de acceso (login, recuperar o cambiar la clave)? */
export function esRutaDeAcceso(ruta: string | null | undefined): boolean {
  const r = ruta ?? '';
  return RUTAS_ACCESO.some((base) => coincide(r, base));
}

/** ¿En esta ruta se muestran los flotantes del panel ("Esto está mal", instalar la app)? */
export function llevaFlotantes(ruta: string | null | undefined): boolean {
  const r = ruta ?? '';
  if (esRutaDeAcceso(r)) return false;
  return !RUTAS_PANTALLA_COMPLETA.some((base) => coincide(r, base));
}
