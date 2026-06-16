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

  return NextResponse.json({ pedidoId: pedido.id, qr: pedido.qr_retiro ?? null, pagoUrl });
}
