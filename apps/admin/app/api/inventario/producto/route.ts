import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API = process.env.API_URL ?? 'http://localhost:3001';

// La ficha de un producto, para abrirla al lado de la lista sin cambiar de
// página (en el escritorio). En el celular se abre con ?sku= como siempre.
export async function GET(req: Request) {
  const token = (await cookies()).get('odb_token')?.value;
  const sku = (new URL(req.url).searchParams.get('sku') ?? '').trim();
  if (!sku) return NextResponse.json({ message: 'Falta el producto' }, { status: 400 });
  const res = await fetch(`${API}/inventario/producto/${encodeURIComponent(sku)}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    cache: 'no-store',
  });
  return NextResponse.json(await res.json().catch(() => ({})), { status: res.status });
}
