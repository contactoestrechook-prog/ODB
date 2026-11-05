import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API = process.env.API_URL ?? 'http://localhost:3001';

// Se volvió a imprimir un ticket: la API anota quién y cuándo.
export async function POST(req: Request) {
  const { ventaId } = await req.json().catch(() => ({ ventaId: '' }));
  if (!ventaId) return NextResponse.json({ message: 'Falta la venta' }, { status: 400 });
  const token = (await cookies()).get('odb_token')?.value;
  const res = await fetch(`${API}/ventas/${encodeURIComponent(ventaId)}/reimpresion`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
