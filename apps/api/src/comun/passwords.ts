import { hashSync, compareSync } from 'bcryptjs';
import { createHash } from 'node:crypto';

// Coste de bcrypt: 10 es el estándar (≈50ms). Sube el techo de fuerza bruta
// respecto de un SHA256 crudo sin salt.
const COSTO = 10;

/** Hashea una clave o PIN con bcrypt (salt incluido en el resultado). */
export function hashClave(texto: string): string {
  return hashSync(texto, COSTO);
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
