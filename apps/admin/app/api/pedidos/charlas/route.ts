import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API = process.env.API_URL ?? 'http://localhost:3001';

async function conToken(): Promise<Record<string, string>> {
  const token = (await cookies()).get('odb_token')?.value;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// Pedidos › Charlas de WhatsApp (14/11/2026): la lista de charlas, «Pasar a
// pedido» (la IA arma, no crea nada) y crear el pedido revisado.
export async function GET() {
  const res = await fetch(`${API}/pedidos/charlas`, { headers: await conToken(), cache: 'no-store' });
  const datos = await res.json().catch(() => ({ message: 'La API no respondió bien' }));
  return NextResponse.json(datos, { status: res.status });
}

export async function POST(req: Request) {
  const { accion, ...cuerpo } = await req.json().catch(() => ({}));
  if (accion !== 'armar' && accion !== 'crear') return NextResponse.json({ message: 'Acción inválida' }, { status: 400 });
  const res = await fetch(`${API}/pedidos/charlas/${accion}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await conToken()) },
    body: JSON.stringify(cuerpo),
  });
  const datos = await res.json().catch(() => ({ message: 'La API no respondió bien' }));
  return NextResponse.json(datos, { status: res.status });
}
