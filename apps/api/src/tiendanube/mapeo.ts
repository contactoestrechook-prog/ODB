// Tienda Nube — LÓGICA PURA de mapeo (sin red ni DB), testeable de forma aislada.
//   ODB producto  → payload de producto de Tienda Nube (push de catálogo)
//   pedido TN      → estructura normalizada para crear un pedido en ODB (pull)

export type ProductoODB = { sku: string; nombre: string; stock?: number };

// TN exige el nombre como objeto localizado ({es:...}) y el precio como string.
export function mapProductoATN(p: ProductoODB, precio: number) {
  return {
    name: { es: p.nombre },
    variants: [
      {
        price: String(precio ?? 0),
        sku: p.sku,
        stock_management: true,
        stock: Math.max(0, Math.round(Number(p.stock ?? 0))),
      },
    ],
    published: true,
  };
}

const PAGADO = ['paid', 'authorized', 'partially_paid'];

// pedido de Tienda Nube → estructura normalizada (ítems por SKU + datos del cliente)
export function mapPedidoTN(order: any) {
  const items = (order?.products ?? []).map((pr: any) => ({
    sku: pr.sku || null,
    name: pr.name || '',
    quantity: Number(pr.quantity ?? 1),
  }));
  const cliente = order?.customer ?? {};
  const dni = order?.customer?.identification || cliente.identification || null;
  return {
    referencia: `TN-${order?.id}`,
    numero: order?.number ?? null,
    clienteNombre: order?.contact_name || cliente.name || null,
    clienteTelefono: order?.contact_phone || cliente.phone || null,
    clienteDni: dni ? String(dni).replace(/\D/g, '') || null : null,
    items,
    pagado: PAGADO.includes(String(order?.payment_status ?? '').toLowerCase()),
    notas: order?.note || order?.owner_note || null,
  };
}
