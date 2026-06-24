import { NextResponse } from 'next/server';

const API = process.env.API_URL ?? 'http://localhost:3001';

// Búsqueda liviana del POS (same-origin, sin CORS) — código de barras + nombre.
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get('q') ?? '';
  const res = await fetch(`${API}/pos/buscar?q=${encodeURIComponent(q)}`, { cache: 'no-store' });
  return NextResponse.json(await res.json(), { status: res.status });
}
