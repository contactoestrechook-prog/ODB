import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API = process.env.API_URL ?? 'http://localhost:3001';

async function token() {
  return (await cookies()).get('odb_token')?.value;
}

// GET ?clienteId=…            → facturas abiertas del cliente
// GET ?reciboId=…             → detalle de un recibo
export async function GET(req: Request) {
  const t = await token();
  const sp = new URL(req.url).searchParams;
  const clienteId = sp.get('clienteId');
  const reciboId = sp.get('reciboId');
  const ruta = reciboId
    ? `/facturacion/recibos/${reciboId}`
    : clienteId
      ? `/facturacion/cuentas/${clienteId}/abiertas`
      : null;
  if (!ruta) return NextResponse.json({ message: 'Falta clienteId o reciboId' }, { status: 400 });
  const res = await fetch(`${API}${ruta}`, {
    headers: t ? { Authorization: `Bearer ${t}` } : {},
    cache: 'no-store',
  });
  return NextResponse.json(await res.json(), { status: res.status });
}

// POST dto → emite el recibo de cobranza (el usuarioId sale del token en la API)
export async function POST(req: Request) {
  const t = await token();
  const dto = await req.json().catch(() => ({}));
  const res = await fetch(`${API}/facturacion/recibos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) },
    body: JSON.stringify(dto),
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
