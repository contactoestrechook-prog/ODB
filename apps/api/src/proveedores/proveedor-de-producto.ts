// EL PROVEEDOR DE UN PRODUCTO, Y CAMBIARLO DESDE CUALQUIER PANTALLA (18/11/2026).
// Leandro: «tenemos que poder cambiar un producto de proveedor desde cualquier
// lado, tiene que ser muy fácil reasignarlo».
//
// Lo que hace el cambio está en la base, todo junto (reasignar_proveedor,
// db/migracion-reasignar-proveedor.sql). Acá: validar lo que llega, nombrar la
// pantalla para la auditoría y decirle a la persona qué pasó, en palabras.

export const PANTALLAS: Record<string, string> = {
  'ficha-producto': 'Ficha del producto',
  stock: 'Stock',
  'que-comprar': 'Qué comprar',
  pedido: 'Armar pedido',
  factura: 'Factura de compra',
  'ficha-proveedor': 'Ficha del proveedor',
  'mesa-compras': 'Mesa de compras',
};

export const esUuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

/** Un producto se nombra por su id o por su SKU (las listas de pedido solo traen el SKU). */
export function refValida(v: unknown): string | null {
  const s = String(v ?? '').trim();
  if (!s || s.length > 60) return null;
  return esUuid(s) ? s.toLowerCase() : s;
}

/** Separa los ids de los SKU, sin repetidos y con tope (lo que se ve en una pantalla). */
export function separarRefs(refs: unknown, tope = 500): { ids: string[]; skus: string[] } {
  const lista = Array.isArray(refs) ? refs : [];
  const ids = new Set<string>();
  const skus = new Set<string>();
  for (const r of lista) {
    const v = refValida(r);
    if (!v) continue;
    if (esUuid(v)) ids.add(v); else skus.add(v);
    if (ids.size + skus.size >= tope) break;
  }
  return { ids: [...ids], skus: [...skus] };
}

/** Quién puede cambiarlo: los mismos que compran (administración hereda comprador). */
export function puedeCambiar(rol: string | null | undefined): boolean {
  return ['dueno', 'gerente', 'comprador', 'administrativo'].includes(String(rol ?? ''));
}

type Prov = { id: string; razonSocial: string };
export type ResultadoReasignar = {
  producto: { id: string; sku: string; nombre: string };
  antes: (Prov & { decidido?: boolean }) | null;
  ahora: Prov;
  yaEstaba: boolean;
  vinculoNuevo: boolean;
  sacados: Prov[];
  quedan: (Prov & { motivo: 'compras' | 'pedidos' | 'codigo' | 'alias' })[];
};

const enLista = (xs: { razonSocial: string }[]) => {
  const n = xs.map((x) => x.razonSocial);
  return n.length <= 1 ? n.join('') : `${n.slice(0, -1).join(', ')} y ${n[n.length - 1]}`;
};

// «Marquisse S.A.» ya termina en punto: no se le pone otro
const punto = (s: string) => (/[.!?]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`);

/** Lo que se le dice a la persona después de cambiarlo. */
export function mensajeReasignado(r: ResultadoReasignar): string {
  if (r.yaEstaba) return punto(`${r.producto.nombre} ya se le compraba a ${r.ahora.razonSocial}`);
  const partes = [punto(`Listo: ${r.producto.nombre} ahora se le compra a ${r.ahora.razonSocial}`)];
  if (r.antes && r.antes.id !== r.ahora.id) partes.push(punto(`Antes era de ${r.antes.razonSocial}`));
  if (r.sacados.length) partes.push(`Salió de la lista de ${enLista(r.sacados)}: nunca se le compró.`);
  if (r.quedan.length) {
    const porCompras = r.quedan.some((q) => q.motivo === 'compras' || q.motivo === 'pedidos');
    partes.push(`Sigue en la lista de ${enLista(r.quedan)} porque ${porCompras ? 'ya se le compró' : 'tiene su código de proveedor'}: queda como historia, pero Qué comprar y los pedidos van a ${punto(r.ahora.razonSocial)}`);
  }
  return partes.join(' ');
}
