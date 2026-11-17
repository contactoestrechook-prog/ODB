// ============================================================
// EL PROVEEDOR, POR SUS ARTÍCULOS (17/11/2026). Leandro: «Ana le tiene que
// explicar y no aprende».
//
// De 36 facturas registradas entre el 12 y el 17/11, en 22 el lector no supo de
// quién eran: remitos de pan, huevos, hielo o fiambres que no traen CUIT ni
// razón social. Sin proveedor no corre nada de lo aprendido (reglas, fichas,
// forma), y Ana terminaba escribiéndole al chat «el proveedor es BIMBO».
//
// Pero lo que trae el papel sí lo dice: si los renglones son los mismos
// artículos que ya se le registraron a UN proveedor, es ese. Se decide solo
// cuando es claro: al menos dos renglones, la mitad del comprobante, y el doble
// que cualquier otro proveedor. Si no, queda sin elegir, como antes.
//
// Funciones puras. Las prueba proveedor-por-articulos.spec.ts.
// ============================================================

export type ArticuloConocido = { proveedor_id: string; clave: string };

/** Las palabras de una clave (ver claveArticulo): las de una letra no dicen nada. */
const palabras = (clave: string) => [...new Set(String(clave ?? '').split(' ').filter((t) => t.length >= 2))];

/**
 * ¿Es el mismo artículo? El lector no siempre copia igual el mismo renglón de
 * un remito («PAN ARTESANO X 500» un día, «BIMBO PAN ARTESANO X 500» otro): son
 * el mismo si todas las palabras del más corto están en el más largo, y el más
 * corto tiene al menos dos.
 */
export function mismoArticulo(a: string, b: string): boolean {
  const [corta, larga] = [palabras(a), palabras(b)].sort((x, y) => x.length - y.length);
  if (corta.length < 2) return false;
  const enLarga = new Set(larga);
  return corta.every((t) => enLarga.has(t));
}

export function proveedorPorArticulos(
  clavesDelPapel: string[],
  conocidos: ArticuloConocido[],
): { proveedorId: string; coinciden: number; de: number } | null {
  const delPapel = [...new Set((clavesDelPapel ?? []).filter((c) => palabras(c).length >= 2))];
  if (delPapel.length < 2 || !conocidos?.length) return null;
  const porProveedor = new Map<string, string[]>();
  for (const c of conocidos) {
    if (!c?.proveedor_id || !c.clave) continue;
    porProveedor.set(c.proveedor_id, [...(porProveedor.get(c.proveedor_id) ?? []), c.clave]);
  }
  const puntos = [...porProveedor.entries()]
    .map(([proveedorId, claves]) => ({ proveedorId, coinciden: delPapel.filter((d) => claves.some((c) => mismoArticulo(d, c))).length }))
    .filter((p) => p.coinciden > 0)
    .sort((a, b) => b.coinciden - a.coinciden);
  const [primero, segundo] = puntos;
  if (!primero || primero.coinciden < 2) return null;
  if (primero.coinciden / delPapel.length < 0.5) return null;
  if (segundo && segundo.coinciden * 2 > primero.coinciden) return null;
  return { proveedorId: primero.proveedorId, coinciden: primero.coinciden, de: delPapel.length };
}
