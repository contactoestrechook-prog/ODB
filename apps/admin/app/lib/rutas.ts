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

/**
 * ¿La pantalla se abrió DESDE AFUERA del panel (un acceso directo o favorito, el enlace de
 * WhatsApp de «Recuperar contraseña») y no navegando adentro? (27/11/2026) Camila Molina
 * caía en «Cambiar mi contraseña» cada vez que entraba sin que el sistema se lo pidiera:
 * entraba por un acceso a esa pantalla o por el enlace de recuperar la clave.
 * Lo que navega adentro con el menú es una consulta interna de Next (encabezado RSC) o
 * viene del mismo sitio (Sec-Fetch-Site same-origin, o el Referer con el mismo host).
 */
export function abiertoDesdeAfuera(h: { get(nombre: string): string | null }): boolean {
  if (h.get('rsc') || h.get('next-router-prefetch')) return false;
  const destino = h.get('sec-fetch-dest');
  if (destino && destino !== 'document') return false;
  const sitio = h.get('sec-fetch-site');
  if (sitio) return sitio !== 'same-origin';
  const referer = h.get('referer');
  if (!referer) return true;
  try { return new URL(referer).host !== h.get('host'); } catch { return true; }
}

/** ¿En esta ruta se muestran los flotantes del panel ("Esto está mal", instalar la app)? */
export function llevaFlotantes(ruta: string | null | undefined): boolean {
  const r = ruta ?? '';
  if (esRutaDeAcceso(r)) return false;
  return !RUTAS_PANTALLA_COMPLETA.some((base) => coincide(r, base));
}
