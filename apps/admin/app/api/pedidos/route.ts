import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API = process.env.API_URL ?? 'http://localhost:3001';

async function conToken(): Promise<Record<string, string>> {
  const token = (await cookies()).get('odb_token')?.value;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function GET() {
  const res = await fetch(`${API}/pedidos`, { headers: await conToken(), cache: 'no-store' });
  return NextResponse.json(await res.json(), { status: res.status });
}

export async function POST(req: Request) {
  const body = await req.json();
  let url: string;
  let payload: any = {};
  if (body.accion === 'waAnalizar') { url = `${API}/pedidos/whatsapp/analizar`; payload = { texto: body.texto }; }
  else if (body.accion === 'waCrear') { url = `${API}/pedidos/whatsapp`; payload = { items: body.items, nombre: body.nombre, notas: body.notas, dni: body.dni }; }
  else if (body.simular) { url = `${API}/pedidosya/simular`; payload = {}; }
  else { url = `${API}/pedidos/${body.pedidoId}/avanzar`; payload = { estado: body.estado }; }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await conToken()) },
    body: JSON.stringify(payload),
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
