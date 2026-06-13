import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API = process.env.API_URL ?? 'http://localhost:3001';

// GET ?recurso=lista|resumen|reactivacion (+ filtros: tipo, filtro, buscar, pagina, dias)
export async function GET(req: Request) {
  const token = (await cookies()).get('odb_token')?.value;
  const url = new URL(req.url);
  const recurso = url.searchParams.get('recurso') ?? 'lista';
  url.searchParams.delete('recurso');
  const qs = url.searchParams.toString();
  const base = recurso === 'resumen' ? '/clientes/resumen' : recurso === 'reactivacion' ? '/clientes/reactivacion' : '/clientes';
  const res = await fetch(`${API}${base}${qs ? `?${qs}` : ''}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    cache: 'no-store',
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
