// EL MISMO COMPROBANTE, AUNQUE EL NÚMERO VENGA ESCRITO DISTINTO (11/11/2026).
//
// El freno a la factura repetida (9/11/2026) comparaba el número letra por
// letra: «06376-00001075» y «6376-1075», o «0637600001075» todo junto, pasaban
// como facturas distintas. El número lo escribe una persona o lo lee una IA de
// una foto, así que la forma cambia. Lo que no cambia es el punto de venta y el
// número: se comparan esos dos, como números.
//
// Funciones puras.

/** «punto de venta-número» sin ceros a la izquierda; null si no se pueden separar. */
export function claveNumero(numero: unknown): string | null {
  const grupos = String(numero ?? '').match(/\d+/g) ?? [];
  if (!grupos.length) return null;
  if (grupos.length >= 2) return `${Number(grupos[grupos.length - 2])}-${Number(grupos[grupos.length - 1])}`;
  // todo junto: los últimos 8 dígitos son el número y lo de antes, el punto de venta
  const g = grupos[0] ?? '';
  if (g.length > 8) return `${Number(g.slice(0, -8))}-${Number(g.slice(-8))}`;
  // un número suelto, sin punto de venta: no alcanza para decir que es el mismo
  return null;
}

export function mismoNumero(a: unknown, b: unknown): boolean {
  const sa = String(a ?? '').trim();
  const sb = String(b ?? '').trim();
  if (!sa || !sb) return false;
  if (sa === sb) return true;
  const ka = claveNumero(sa);
  return ka != null && ka === claveNumero(sb);
}
