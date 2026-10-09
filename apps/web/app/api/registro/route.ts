import { NextResponse } from "next/server";
import { API } from "../../../lib/api";
import { leerJson, mensajeDeError, SIN_CONEXION } from "../../../lib/respuesta";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  // Si la API está caída o contesta algo que no es JSON, mensaje humano (antes
  // el cliente veía "Unexpected token…").
  let res: Response;
  try {
    res = await fetch(`${API}/app/registro-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    return NextResponse.json({ message: SIN_CONEXION }, { status: 503 });
  }
  const d = await leerJson(res);
  if (!res.ok) {
    return NextResponse.json({ message: mensajeDeError(d, res.status, "No pudimos crear la cuenta. Probá de nuevo.") }, { status: res.status >= 500 ? 502 : res.status });
  }
  if (!d?.token) return NextResponse.json({ message: SIN_CONEXION }, { status: 502 });
  const resp = NextResponse.json({ cliente: d.cliente });
  resp.cookies.set("odb_cliente", d.token, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 });
  return resp;
}
