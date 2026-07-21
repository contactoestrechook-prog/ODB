import { hashSync, compareSync } from 'bcryptjs';
import { createHash } from 'node:crypto';

// Coste de bcrypt: 10 es el estándar (≈50ms). Sube el techo de fuerza bruta
// respecto de un SHA256 crudo sin salt.
const COSTO = 10;

/**
 * Hashea una clave o PIN con bcrypt (salt incluido en el resultado).
 *
 * bcryptjs genera hashes con prefijo `$2b$`, pero el login y la verificación de
 * PIN corren en la base con `crypt()` de pgcrypto, que NO valida `$2b$` (da
 * siempre falso). Para claves de <72 bytes —todas las nuestras— `$2a$` y `$2b$`
 * son idénticos en verificación, así que relabelamos el prefijo a `$2a$`: así
 * el hash generado acá es compatible con verificar_login / verificar_pin_supervisor.
 * Sin esto, cualquier usuario creado o clave cambiada desde el panel no podría loguearse.
 */
export function hashClave(texto: string): string {
  return hashSync(texto, COSTO).replace(/^\$2b\$/, '$2a$');
}

/**
 * Verifica una clave contra un hash almacenado. Acepta tanto bcrypt (nuevo,
 * empieza con `$2`) como el SHA256 hex legacy, para no dejar afuera a los
 * usuarios creados antes de la migración. La verificación en SQL
 * (verificar_login / aprobar_orden_compra) hace el mismo doble chequeo.
 */
export function verificarClave(texto: string, hash: string | null | undefined): boolean {
  if (!hash) return false;
  if (hash.startsWith('$2')) return compareSync(texto, hash);
  const sha = createHash('sha256').update(texto).digest('hex');
  return sha === hash;
}

/** True si el hash sigue en el formato legacy y conviene re-hashear a bcrypt. */
export function esLegacy(hash: string | null | undefined): boolean {
  return !!hash && !hash.startsWith('$2');
}
