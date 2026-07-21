import { NextResponse } from 'next/server';

const API = process.env.API_URL ?? 'http://localhost:3001';

// Autocompletar de productos para los modales del panel. Acepta filtro por
// rubro (categoria): cuando un renglón no matcheó, se busca dentro de su rubro.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams.get('q') ?? '';
  const categoria = url.searchParams.get('categoria') ?? '';
  const params = new URLSearchParams({ buscar: q, porPagina: '12' });
  if (categoria) params.set('categoriaId', categoria);
  const res = await fetch(`${API}/productos?${params.toString()}`);
  return NextResponse.json(await res.json(), { status: res.status });
}
