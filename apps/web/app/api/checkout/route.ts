import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { API } from "../../../lib/api";
import { leerJson, mensajeDeError, SIN_CONEXION } from "../../../lib/respuesta";
import { errorDeWhatsapp, revisarWhatsapp } from "../../../lib/telefono";

const falla = (message: string, status: number) => NextResponse.json({ message }, { status });

export async function POST(req: Request) {
  const token = (await cookies()).get("odb_cliente")?.value;
  const auth: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return falla("No pudimos leer el pedido. Probá de nuevo.", 400);

  // Nombre y WhatsApp del que compra (6/10/2026): la tienda le avisa por
  // WhatsApp cuando el pedido está listo. Se vuelven a revisar acá aunque la
  // pantalla ya lo haya hecho, y el número viaja normalizado a 10 dígitos.
  const nombre = String(body.contacto?.nombre ?? "").trim().replace(/\s+/g, " ").slice(0, 80);
  if (!nombre) return falla("Escribí tu nombre.", 400);
  const wa = revisarWhatsapp(String(body.contacto?.telefono ?? ""));
  if (!wa.ok) return falla(errorDeWhatsapp(wa)!, 400);

  const tipo = body.tipo === "domicilio" ? "domicilio" : "pickup";
  const pedidoNuevo = {
    tipo,
    items: Array.isArray(body.items) ? body.items.map((i: any) => ({ sku: String(i?.sku ?? ""), cantidad: Number(i?.cantidad) })) : [],
    destino: tipo === "domicilio" ? { direccion: String(body.destino?.direccion ?? "").trim().slice(0, 300) } : undefined,
    origen: "web",
    contacto: { nombre, telefono: wa.numero },
  };

  // crea el pedido (atribuido al cliente si hay token). Si la API está caída o
  // contesta algo que no es JSON, el cliente lee un mensaje humano y no
  // "Unexpected token…".
  let r: Response;
  try {
    r = await fetch(`${API}/app/pedidos`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...auth },
      body: JSON.stringify(pedidoNuevo),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    return falla(SIN_CONEXION, 503);
  }
  const pedido = await leerJson(r);
  if (!r.ok) return falla(mensajeDeError(pedido, r.status, "No pudimos crear el pedido. Probá de nuevo."), r.status >= 500 ? 502 : r.status);
  if (!pedido?.id) return falla(SIN_CONEXION, 502);

  // intenta generar el link de pago de Mercado Pago (si está configurado). Al
  // terminar de pagar, la API devuelve al cliente a /pedido/<id>.
  let pagoUrl: string | null = null;
  try {
    const pg = await fetch(`${API}/app/pedidos/${pedido.id}/pago`, { method: "POST", headers: auth, signal: AbortSignal.timeout(15_000) });
    if (pg.ok) pagoUrl = (await leerJson(pg))?.url ?? null;
  } catch {}

  // El detalle tal como lo registró el sistema: POST /app/pedidos ya devuelve el
  // pedido con sus renglones (precio_unitario de la base) y el total. La
  // pantalla lo dibuja en la Placa roja (2/10/2026).
  const renglones = Array.isArray(pedido.items)
    ? pedido.items.map((i: any) => ({
        sku: i.producto?.sku ?? null,
        nombre: i.producto?.nombre ?? "Producto",
        cantidad: Number(i.cantidad),
        unitario: i.precio_unitario == null ? null : Number(i.precio_unitario),
      }))
    : null;
  const total = pedido.total == null ? null : Number(pedido.total);

  return NextResponse.json({ pedidoId: pedido.id, qr: pedido.qr_retiro ?? null, pagoUrl, total, renglones, telefono: wa.numero });
}
