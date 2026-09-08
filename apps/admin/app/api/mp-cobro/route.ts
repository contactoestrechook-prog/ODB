import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API = process.env.API_URL ?? 'http://localhost:3001';

// Cobro con QR integrado de Mercado Pago desde la línea de cajas:
//   GET  ?id=<cobro>                    → estado del cobro (pendiente / aprobado / vencido…)
//   GET  ?cajas=1&sucursalId=<id>       → QR disponibles en la cuenta de MP de la sucursal
//   POST { accion: 'iniciar', cajaId, monto, detalle }  → manda el importe al QR de la caja
//   POST { accion: 'cancelar', id }                     → borra la orden del QR
//   POST { accion: 'vincular', cajaId, posId }          → qué QR de MP tiene esta caja
//   POST { accion: 'venta', id, ventaId }               → el pago queda atado a la venta registrada
async function conToken(): Promise<Record<string, string>> {
  const token = (await cookies()).get('odb_token')?.value;
  return { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const headers = await conToken();
  const id = url.searchParams.get('id');
  const destino = id
    ? `${API}/mercadopago/cobro-qr/${encodeURIComponent(id)}`
    : `${API}/mercadopago/cajas-qr?sucursalId=${encodeURIComponent(url.searchParams.get('sucursalId') ?? '')}`;
  const res = await fetch(destino, { headers, cache: 'no-store' });
  return NextResponse.json(await res.json().catch(() => ({})), { status: res.status });
}

export async function POST(req: Request) {
  const headers = await conToken();
  const body = await req.json().catch(() => ({}));
  const accion = String(body?.accion ?? '');
  let res: Response;
  if (accion === 'iniciar') {
    res = await fetch(`${API}/mercadopago/cobro-qr`, { method: 'POST', headers, body: JSON.stringify({ cajaId: body.cajaId, monto: body.monto, detalle: body.detalle }) });
  } else if (accion === 'cancelar') {
    res = await fetch(`${API}/mercadopago/cobro-qr/${encodeURIComponent(String(body.id ?? ''))}`, { method: 'DELETE', headers });
  } else if (accion === 'vincular') {
    res = await fetch(`${API}/mercadopago/vincular-caja-qr`, { method: 'POST', headers, body: JSON.stringify({ cajaId: body.cajaId, posId: body.posId ?? null }) });
  } else if (accion === 'venta') {
    res = await fetch(`${API}/mercadopago/cobro-qr/${encodeURIComponent(String(body.id ?? ''))}/venta`, { method: 'POST', headers, body: JSON.stringify({ ventaId: body.ventaId }) });
  } else {
    return NextResponse.json({ message: 'Acción desconocida' }, { status: 400 });
  }
  return NextResponse.json(await res.json().catch(() => ({})), { status: res.status });
}
