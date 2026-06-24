import { NextResponse } from 'next/server';

const API = process.env.API_URL ?? 'http://localhost:3001';

// Catálogo con stock para precargar en la caja (búsqueda local instantánea).
export async function GET() {
  const res = await fetch(`${API}/pos/catalogo`, { cache: 'no-store' });
  return NextResponse.json(await res.json(), { status: res.status });
}
