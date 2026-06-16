import { NextResponse } from "next/server";

const API = process.env.API_URL ?? "http://localhost:3001";

export async function GET(req: Request) {
  const sku = new URL(req.url).searchParams.get("sku");
  if (!sku) return NextResponse.json({ nota: null, maridaje: null });
  try {
    const r = await fetch(`${API}/productos/${encodeURIComponent(sku)}/nota`, { cache: "no-store" });
    return NextResponse.json(await r.json(), { status: r.status });
  } catch {
    return NextResponse.json({ nota: null, maridaje: null });
  }
}
