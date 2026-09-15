import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API = process.env.API_URL ?? 'http://localhost:3001';

// Detalle completo de una venta (renglones, pagos, comprobante, cambios previos)
export async function GET(req: Request) {
  const token = (await cookies()).get('odb_token')?.value;
  const ventaId = new URL(req.url).searchParams.get('ventaId') ?? '';
  if (!ventaId) return NextResponse.json({ message: 'Falta la venta' }, { status: 400 });
  const res = await fetch(`${API}/ventas/${encodeURIComponent(ventaId)}/detalle`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    cache: 'no-store',
  });
  return NextResponse.json(await res.json(), { status: res.status });
}

// Cambia con qué quedó pagada una venta ya cobrada (requiere PIN de supervisor).
// Si sale Mercado Pago, el backend devuelve esa plata por MP antes de tocar nada.
export async function POST(req: Request) {
  const { ventaId, ...dto } = await req.json().catch(() => ({ ventaId: '' }));
  if (!ventaId) return NextResponse.json({ message: 'Falta la venta' }, { status: 400 });
  const token = (await cookies()).get('odb_token')?.value;
  const res = await fetch(`${API}/ventas/${encodeURIComponent(ventaId)}/medio-pago`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(dto),
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
