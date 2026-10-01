// La propuesta de compra como la ve el comprador: una nota de pedido por
// proveedor y sucursal, con cada producto listo para tildar (1/10/2026).
//
// Antes la sugerencia salía como texto del agente, una lista con guiones adentro
// del chat que había que leer y después repetirle al agente para que la armara.
// Ahora se dibuja como lo que es: renglones con casilla, cantidad editable y los
// números que la justifican.
//
// Todos los números salen de abastecimiento() (la base); acá solo se agrupa y se
// ordena. El agente elige productos y cantidades, nunca stock ni ritmo.

export type RenglonPropuesta = {
  sku: string;
  productoId: string;
  nombre: string;
  foto: string | null;
  stock: number;
  enCamino: number;
  ritmoDia: number;
  // días que alcanza el stock al ritmo de venta; null = no se vende
  coberturaDias: number | null;
  alerta: 'sin_stock' | 'no_llega' | 'menos_de_12' | null;
  sugerido: number;
  cantidad: number;
  costo: number | null;
  motivo: string | null;
  tildado: boolean;
};

export type Propuesta = {
  clave: string;
  proveedorId: string;
  proveedor: string;
  sucursalId: string;
  sucursal: string;
  // lo que le falta al proveedor para poder comprarle (proveedor_faltantes)
  faltan: string[];
  plazoDias: number | null;
  plazoFuente: string | null;
  items: RenglonPropuesta[];
  urgentes: number;
  total: number;
};

const ORDEN_ALERTA: Record<string, number> = { sin_stock: 0, no_llega: 1, menos_de_12: 2 };

export const nombreSucursal = (s: any) =>
  String(s ?? '').replace(/^Suc\s+/, '').replace(/^Sant Thomas/, 'Saint Thomas').replace(/^Santa Ines$/, 'Santa Inés');

const num = (v: any, dec = 2) => (v == null || Number.isNaN(Number(v)) ? 0 : Math.round(Number(v) * 10 ** dec) / 10 ** dec);

// La cantidad que viaja a la orden: entera y positiva. Un sugerido de 13,2
// unidades no se puede pedir; se redondea para arriba, como armar_orden.
export const cantidadPedible = (v: any) => {
  const n = Math.ceil(Number(v));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

export function armarPropuestas(
  filas: any[],
  opciones: {
    // propuesta del agente: solo estos productos, con su cantidad (y tildados).
    // Sin esto es la vista directa: todo lo que tiene sugerido.
    pedidos?: Map<string, { cantidad: number; motivo?: string | null }>;
    conFoto?: Set<string>;
    urlFoto?: (sku: string) => string;
  } = {},
): Propuesta[] {
  const grupos = new Map<string, Propuesta>();
  for (const f of filas) {
    if (!f?.proveedor_id || !f?.sku) continue;
    const pedido = opciones.pedidos?.get(f.sku);
    if (opciones.pedidos && !pedido) continue;
    const sugerido = cantidadPedible(f.cantidad_sugerida);
    const cantidad = pedido ? cantidadPedible(pedido.cantidad) : sugerido;
    if (!cantidad) continue;

    const clave = `${f.proveedor_id}:${f.sucursal_id}`;
    let g = grupos.get(clave);
    if (!g) {
      g = {
        clave, proveedorId: f.proveedor_id, proveedor: f.proveedor ?? '—',
        sucursalId: f.sucursal_id, sucursal: nombreSucursal(f.sucursal),
        faltan: Array.isArray(f.proveedor_faltan) ? f.proveedor_faltan : [],
        plazoDias: f.plazo_dias == null ? null : num(f.plazo_dias, 1),
        plazoFuente: f.plazo_fuente ?? null,
        items: [], urgentes: 0, total: 0,
      };
      grupos.set(clave, g);
    }
    const alerta = (f.alerta ?? null) as RenglonPropuesta['alerta'];
    const urgente = alerta === 'sin_stock' || alerta === 'no_llega';
    // el costo va tal cual: redondear antes de multiplicar desvía el total de la orden
    const costo = f.ultimo_costo == null || Number.isNaN(Number(f.ultimo_costo)) ? null : Number(f.ultimo_costo);
    // en la vista directa vienen tildados los urgentes; lo que solo bajó de 12
    // queda para que el comprador decida. Lo que propone el agente viene tildado.
    const tildado = pedido ? true : urgente;
    g.items.push({
      sku: f.sku, productoId: f.producto_id, nombre: f.nombre ?? f.sku,
      foto: opciones.conFoto?.has(f.producto_id) && opciones.urlFoto ? opciones.urlFoto(f.sku) : null,
      stock: num(f.stock), enCamino: num(f.en_camino), ritmoDia: num(f.ritmo_dia),
      coberturaDias: Number(f.ritmo_dia) > 0 && f.cobertura_dias != null ? num(f.cobertura_dias, 1) : null,
      alerta, sugerido, cantidad, costo, motivo: pedido?.motivo?.trim() || null, tildado,
    });
    if (urgente) g.urgentes++;
    if (tildado) g.total += (costo ?? 0) * cantidad;
  }

  const lista = [...grupos.values()];
  for (const g of lista) {
    g.items.sort((a, b) =>
      (ORDEN_ALERTA[a.alerta ?? ''] ?? 3) - (ORDEN_ALERTA[b.alerta ?? ''] ?? 3)
      || (a.coberturaDias ?? 9999) - (b.coberturaDias ?? 9999)
      || b.ritmoDia - a.ritmoDia
      || a.nombre.localeCompare(b.nombre));
  }
  // arriba el proveedor con más urgencias; a igualdad, el que más plata mueve
  return lista.sort((a, b) => b.urgentes - a.urgentes || b.total - a.total || a.proveedor.localeCompare(b.proveedor));
}
