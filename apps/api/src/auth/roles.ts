// Varios roles por persona (Leandro, 19/11/2026, planilla de St Thomas y Santa
// Inés: la misma persona es Caja + Op salón + Reparto, o Administrativo + Caja).
//
// usuarios.rol   = el principal: adónde entra y lo que mira el código viejo.
// usuarios.roles = todos, con el principal primero (lo mantiene un trigger).
//
// La regla para no regalar permisos: en cada pedido la persona ACTÚA con el rol
// que le abrió la puerta. Una administrativa que también es cajera, en la caja,
// es una cajera (abre su caja, ve solo su cierre); en facturas de compra es
// administrativa. Nunca suma lo de los dos roles en una misma acción.

/** Qué roles "hereda" cada rol compuesto (además de sí mismo). */
export const ROLES_IMPLICADOS: Record<string, string[]> = {
  administrativo: ['administrativo', 'comprador', 'deposito'],
  // Fiambrería arma como el op salón (lo que le asigna la caja, en su sucursal)
  fiambreria: ['fiambreria', 'op_salon'],
};

/** Roles que solo entran donde @Roles los nombra (celular, una sola pantalla). */
export const ROLES_ENCERRADOS = ['op_salon', 'fiambreria'];

/** Orden para elegir el principal: el de más alcance primero. */
export const ORDEN_ROLES = ['dueno', 'gerente', 'administrativo', 'comprador', 'cajero', 'deposito', 'repartidor', 'op_salon', 'fiambreria'];

export const ROLES_VALIDOS = new Set(ORDEN_ROLES);

/** Todos los roles de un usuario (token o fila); los tokens viejos traen solo `rol`. */
export function rolesDe(u: { rol?: string | null; roles?: unknown } | null | undefined): string[] {
  const lista = Array.isArray(u?.roles) ? (u!.roles as unknown[]).map(String).filter(Boolean) : [];
  const principal = u?.rol ? String(u.rol) : null;
  const todos = principal ? [principal, ...lista] : lista;
  return [...new Set(todos)];
}

/** Lo que puede cada rol, contando la herencia. */
export function implicados(rol: string): string[] {
  return ROLES_IMPLICADOS[rol] ?? [rol];
}

/** Encerrado solo si TODOS sus roles lo son (op salón que también es cajero, no). */
export function estaEncerrado(roles: string[]): boolean {
  return roles.length > 0 && roles.every((r) => ROLES_ENCERRADOS.includes(r));
}

/**
 * Con qué rol actúa en esta acción: el principal si alcanza; si no, el primero
 * de los suyos que la permite. null = ninguno la permite.
 */
export function rolQueEntra(roles: string[], pedidos: string[] | undefined, sinHerencia = false): string | null {
  if (!roles.length) return null;
  if (!pedidos?.length) return roles[0];
  for (const r of roles) {
    const puede = sinHerencia ? [r] : implicados(r);
    if (pedidos.some((p) => puede.includes(p))) return r;
  }
  return null;
}

/** De una lista de roles, el principal (el de más alcance). */
export function rolPrincipal(roles: string[]): string | null {
  const validos = roles.filter((r) => ROLES_VALIDOS.has(r));
  if (!validos.length) return null;
  return [...validos].sort((a, b) => ORDEN_ROLES.indexOf(a) - ORDEN_ROLES.indexOf(b))[0];
}

/** Ordena y limpia: principal primero, sin repetidos ni roles inexistentes. */
export function normalizarRoles(roles: unknown, principal?: string | null): string[] {
  const lista = (Array.isArray(roles) ? roles : []).map(String).filter((r) => ROLES_VALIDOS.has(r));
  const p = principal && ROLES_VALIDOS.has(principal) ? principal : rolPrincipal(lista);
  if (!p) return [];
  return [p, ...[...new Set(lista)].filter((r) => r !== p).sort((a, b) => ORDEN_ROLES.indexOf(a) - ORDEN_ROLES.indexOf(b))];
}
