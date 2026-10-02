import { NextResponse } from "next/server";
import { cookies } from "next/headers";

const API = process.env.API_URL ?? "http://localhost:3001";

export async function POST(req: Request) {
  const token = (await cookies()).get("odb_cliente")?.value;
  const auth: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
  const body = await req.json().catch(() => ({}));

  // crea el pedido (atribuido al cliente si hay token)
  const r = await fetch(`${API}/app/pedidos`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...auth },
    body: JSON.stringify(body),
  });
  const pedido = await r.json();
  if (!r.ok) return NextResponse.json(pedido, { status: r.status });

  // intenta generar el link de pago de Mercado Pago (si está configurado)
  let pagoUrl: string | null = null;
  try {
    const pg = await fetch(`${API}/app/pedidos/${pedido.id}/pago`, { method: "POST", headers: auth });
    if (pg.ok) {
      const d = await pg.json();
      pagoUrl = d.url ?? null;
    }
  } catch {}

  // El detalle tal como lo registró el sistema: POST /app/pedidos ya devuelve el
  // pedido con sus renglones (precio_unitario de la base) y el total. Antes se
  // tiraba y "¡Pedido recibido!" mostraba solo el código; ahora la pantalla lo
  // dibuja en la Placa roja (2/10/2026). Sin llamadas nuevas a la API.
  const renglones = Array.isArray(pedido.items)
    ? pedido.items.map((i: any) => ({
        sku: i.producto?.sku ?? null,
        nombre: i.producto?.nombre ?? "Producto",
        cantidad: Number(i.cantidad),
        unitario: i.precio_unitario == null ? null : Number(i.precio_unitario),
      }))
    : null;
  const total = pedido.total == null ? null : Number(pedido.total);

  return NextResponse.json({ pedidoId: pedido.id, qr: pedido.qr_retiro ?? null, pagoUrl, total, renglones });
}
