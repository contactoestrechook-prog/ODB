// ============================================================
// LA SUCURSAL NO ARRANCA VACÍA (12/11/2026). Juan Pablo cargó la factura de
// Leares (A 00003-00002439) y «Registrar entrada + factura» quedó apagado sin
// decir por qué: la sucursal estaba en «Sucursal…», arriba de todo, y él no
// tiene una asignada. Terminó registrándola «para conciliar» y la mercadería
// no entró al stock. Ahora arranca con la última que se eligió en esa compu y,
// si nunca se eligió, con la que más mercadería recibe (la de más órdenes de
// compra; Sant Thomas tenía 84 remitos contra 2 de Santa Inés).
// Se prueba en apps/api/src/compras/sucursal-habitual.spec.ts.
// ============================================================

export type SucursalElegible = { id: string; nombre: string };
type OrdenConSucursal = { sucursal?: { nombre?: string | null } | null };

const CLAVE = 'odb.compras.sucursal';

export function sucursalHabitual(sucursales: SucursalElegible[], ordenes: OrdenConSucursal[], guardada?: string | null): string {
  if (guardada && sucursales.some((s) => s.id === guardada)) return guardada;
  const veces = new Map<string, number>();
  for (const o of ordenes ?? []) {
    const nombre = o?.sucursal?.nombre;
    if (nombre) veces.set(nombre, (veces.get(nombre) ?? 0) + 1);
  }
  let mejor: SucursalElegible | null = null;
  let max = 0;
  for (const s of sucursales) {
    const v = veces.get(s.nombre) ?? 0;
    if (v > max) { mejor = s; max = v; }
  }
  if (mejor) return mejor.id;
  return sucursales.length === 1 ? sucursales[0].id : '';
}

/** la última sucursal elegida en esta compu (null si no hay o el navegador no deja guardar) */
export function sucursalGuardada(): string | null {
  try { return window.localStorage.getItem(CLAVE); } catch { return null; }
}

export function guardarSucursal(id: string) {
  try {
    if (id) window.localStorage.setItem(CLAVE, id);
    else window.localStorage.removeItem(CLAVE);
  } catch { /* sin almacenamiento: la próxima arranca con la habitual */ }
}
