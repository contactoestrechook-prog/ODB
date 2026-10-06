import { NextResponse } from "next/server";
import { buscarPedido } from "../../../../lib/pedido";
import { SIN_CONEXION } from "../../../../lib/respuesta";

// La pantalla de seguimiento pide el pedido acá cada 20 s (el navegador no
// conoce la dirección de la API).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const b = await buscarPedido(id);
  if (b.tipo === "ok") return NextResponse.json(b.pedido, { headers: { "Cache-Control": "no-store" } });
  if (b.tipo === "no-existe") return NextResponse.json({ message: "No encontramos ese pedido." }, { status: 404 });
  return NextResponse.json({ message: SIN_CONEXION }, { status: 502 });
}
