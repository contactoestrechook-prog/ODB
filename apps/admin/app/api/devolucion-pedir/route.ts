import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API = process.env.API_URL ?? 'http://localhost:3001';

async function conToken(): Promise<Record<string, string>> {
  const token = (await cookies()).get('odb_token')?.value;
  return { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

// Devolución en caja SIN supervisor presente: la cajera pide la autorización a
// distancia (WhatsApp + campanita a los supervisores) y consulta cómo va.
//   POST { ventaId, items, reintegro, sesionCajaId, motivo } → { id, monto, avisados }
//   GET  ?id=<pedido>                                       → { estado, resultado, respuesta, resueltaPor }
export async function POST(req: Request) {
  const { ventaId, ...dto } = await req.json().catch(() => ({}));
  if (!ventaId) return NextResponse.json({ message: 'Falta la venta' }, { status: 400 });
  const res = await fetch(`${API}/ventas/${encodeURIComponent(ventaId)}/devolucion-pedir`, {
    method: 'POST', headers: await conToken(), body: JSON.stringify(dto),
  });
  return NextResponse.json(await res.json().catch(() => ({})), { status: res.status });
}

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get('id') ?? '';
  const res = await fetch(`${API}/ventas/devolucion-estado/${encodeURIComponent(id)}`, { headers: await conToken(), cache: 'no-store' });
  return NextResponse.json(await res.json().catch(() => ({})), { status: res.status });
}
