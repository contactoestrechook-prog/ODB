import { NextResponse } from 'next/server';

const API = process.env.API_URL ?? 'http://localhost:3001';

// Autocompletar de productos para los modales del panel. Acepta filtro por
// rubro (categoria): cuando un renglón no matcheó, se busca dentro de su rubro.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams.get('q') ?? '';
  const categoria = url.searchParams.get('categoria') ?? '';
  // Cuando se filtra por rubro queremos ver TODOS los productos de esa categoría
  // (ej. todos los helados), no una muestra: 200 es el tope del backend. Para la
  // búsqueda por texto (usada en varios modales) dejamos el 12 de siempre: se
  // afina escribiendo, y no cambiamos la carga de los otros consumidores.
  const params = new URLSearchParams({ buscar: q, porPagina: categoria ? '200' : '12' });
  if (categoria) params.set('categoriaId', categoria);
  const res = await fetch(`${API}/productos?${params.toString()}`);
  return NextResponse.json(await res.json(), { status: res.status });
}
