import { NextResponse } from "next/server";
import { cookies } from "next/headers";

const API = process.env.API_URL ?? "http://localhost:3001";

// Puente del asistente de compras a la API. Reenvía la sesión del cliente (si
// entró) para que vea sus precios de socio.
export const maxDuration = 90;

export async function POST(req: Request) {
  const cuerpo = await req.json().catch(() => ({}));
  const token = (await cookies()).get("odb_cliente")?.value;
  try {
    const r = await fetch(`${API}/asistente/charla`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ mensajes: cuerpo?.mensajes ?? [] }),
      signal: AbortSignal.timeout(80_000),
    });
    const texto = await r.text();
    try {
      return NextResponse.json(texto ? JSON.parse(texto) : {}, { status: r.status });
    } catch {
      return NextResponse.json({ message: "El asistente tardó demasiado. Probá de nuevo." }, { status: 502 });
    }
  } catch {
    return NextResponse.json({ message: "No pude conectarme con el asistente. Probá de nuevo." }, { status: 504 });
  }
}
