import { NextResponse } from 'next/server';

const API = process.env.API_URL ?? 'http://localhost:3001';

// Autocompletar de productos para los modales del panel
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get('q') ?? '';
  const res = await fetch(`${API}/productos?buscar=${encodeURIComponent(q)}&porPagina=8`);
  return NextResponse.json(await res.json(), { status: res.status });
}
