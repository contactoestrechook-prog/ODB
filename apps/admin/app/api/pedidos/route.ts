import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API = process.env.API_URL ?? 'http://localhost:3001';

async function conToken(): Promise<Record<string, string>> {
  const token = (await cookies()).get('odb_token')?.value;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// ?historial=<id>: quién hizo cada cosa con ese pedido. ?vista=terminados: entregados,
// en camino y cancelados de los últimos días (6/10/2026).
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const historial = q.get('historial');
  const ruta = historial
    ? `/pedidos/${encodeURIComponent(historial)}/historial`
    : q.get('vista') === 'terminados'
      ? `/pedidos/terminados?dias=${encodeURIComponent(q.get('dias') ?? '7')}`
      : '/pedidos';
  const res = await fetch(`${API}${ruta}`, { headers: await conToken(), cache: 'no-store' });
  const datos = await res.json().catch(() => ({ message: 'La API no respondió bien' }));
  return NextResponse.json(datos, { status: res.status });
}

export async function POST(req: Request) {
  const body = await req.json();
  let url: string;
  let payload: any = {};
  if (body.accion === 'waAnalizar') { url = `${API}/pedidos/whatsapp/analizar`; payload = { texto: body.texto }; }
  else if (body.accion === 'waCrear') { url = `${API}/pedidos/whatsapp`; payload = { items: body.items, nombre: body.nombre, notas: body.notas, dni: body.dni }; }
  else if (body.simular) { url = `${API}/pedidosya/simular`; payload = {}; }
  else if (body.accion === 'tomar') { url = `${API}/pedidos/${encodeURIComponent(body.pedidoId)}/tomar`; payload = {}; }
  else { url = `${API}/pedidos/${encodeURIComponent(body.pedidoId)}/avanzar`; payload = { estado: body.estado, ...(body.medioPago ? { medioPago: body.medioPago } : {}) }; }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await conToken()) },
    body: JSON.stringify(payload),
  });
  const datos = await res.json().catch(() => ({ message: 'La API no respondió bien' }));
  return NextResponse.json(datos, { status: res.status });
}
