// Leer lo que contesta la API (o una ruta propia) sin romperse. Antes cada ruta
// hacía `await res.json()` a pelo: si la API estaba caída o Railway devolvía su
// página HTML de error, el cliente veía "Unexpected token '<'…" (6/10/2026).
// Sin imports de servidor: lo usan tanto las rutas de /api como las pantallas.

export const SIN_CONEXION = "No pudimos conectar con la tienda. Probá de nuevo en un minuto.";
export const DEMASIADOS_INTENTOS = "Hubo demasiados intentos seguidos. Esperá un minuto y probá de nuevo.";

/** El cuerpo como JSON, o null si no vino nada o no era JSON. Nunca tira. */
export async function leerJson(r: Response): Promise<any | null> {
  try {
    const t = await r.text();
    return t ? JSON.parse(t) : null;
  } catch {
    return null;
  }
}

/**
 * El mensaje para el cliente cuando la respuesta no fue ok. Los errores de la
 * API (Nest) traen `message` en castellano, a veces como lista. Un 5xx o una
 * respuesta que no es JSON es "no pudimos conectar"; un 429 trae el texto en
 * inglés del limitador ("ThrottlerException…"), así que va el nuestro.
 */
export function mensajeDeError(d: any, status: number, porDefecto: string): string {
  if (status === 429) return DEMASIADOS_INTENTOS;
  if (status >= 500 || !d || typeof d !== "object") return SIN_CONEXION;
  const m = Array.isArray(d.message) ? d.message.filter((x: unknown) => typeof x === "string").join(". ") : d.message;
  if (typeof m !== "string" || !m.trim() || /exception|internal server error/i.test(m)) return porDefecto;
  return m;
}
