import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API = process.env.API_URL ?? 'http://localhost:3001';

async function conToken(): Promise<Record<string, string>> {
  const t = (await cookies()).get('odb_token')?.value;
  return t ? { Authorization: `Bearer ${t}` } : {};
}

// Si la API contesta algo que no es JSON (un 502 del proxy, una página de
// error), la pantalla recibe un mensaje y no un 500 de esta ruta.
async function reenviar(res: Response) {
  const datos = await res.json().catch(() => ({ message: 'La API no respondió bien' }));
  return NextResponse.json(datos, { status: res.status });
}

// GET: los envíos activos. ?que=quien-lleva: repartidores y gente del local
// que puede llevar un envío (21/10/2026).
export async function GET(req: Request) {
  const que = new URL(req.url).searchParams.get('que');
  const ruta = que === 'quien-lleva' ? '/envios/quien-lleva' : '/envios';
  const res = await fetch(`${API}${ruta}`, { headers: await conToken(), cache: 'no-store' }).catch(() => null);
  if (!res) return NextResponse.json({ message: 'No pude comunicarme con la API' }, { status: 502 });
  return reenviar(res);
}

// POST { accion: 'se-entrego', pedidoId, medioPago? }: «¿Se entregó o se
// cancela?» → se entregó (un envío viejo que se entregó sin marcarlo).
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  if (body?.accion !== 'se-entrego' || !body?.pedidoId) return NextResponse.json({ message: 'Acción inválida' }, { status: 400 });
  const res = await fetch(`${API}/envios/${encodeURIComponent(body.pedidoId)}/se-entrego`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await conToken()) },
    body: JSON.stringify(body.medioPago ? { medioPago: body.medioPago } : {}),
  }).catch(() => null);
  if (!res) return NextResponse.json({ message: 'No pude comunicarme con la API' }, { status: 502 });
  return reenviar(res);
}
