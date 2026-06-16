import { NextResponse } from "next/server";

const API = process.env.API_URL ?? "http://localhost:3001";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const res = await fetch(`${API}/app/login-email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const d = await res.json();
  if (!res.ok) return NextResponse.json(d, { status: res.status });
  const resp = NextResponse.json({ cliente: d.cliente });
  resp.cookies.set("odb_cliente", d.token, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 });
  return resp;
}
