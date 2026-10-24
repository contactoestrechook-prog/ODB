import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API = process.env.API_URL ?? 'http://localhost:3001';
async function tok(): Promise<Record<string, string>> { const t = (await cookies()).get('odb_token')?.value; return t ? { Authorization: `Bearer ${t}` } : {}; }

// el resumen de saldo por WhatsApp: estado, quiénes lo reciben y las tandas
export async function GET() {
  const res = await fetch(`${API}/cta-cte/resumenes`, { headers: await tok(), cache: 'no-store' });
  return NextResponse.json(await res.json(), { status: res.status });
}

// prender / pausar, el mensaje y el piso
export async function PATCH(req: Request) {
  const res = await fetch(`${API}/cta-cte/resumenes/config`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', ...(await tok()) }, body: JSON.stringify(await req.json()),
  });
  return NextResponse.json(await res.json(), { status: res.status });
}

// { accion: 'prueba', telefono, clienteId? } o { accion: 'enviar-ahora' }
export async function POST(req: Request) {
  const { accion, ...resto } = await req.json().catch(() => ({}));
  if (accion !== 'prueba' && accion !== 'enviar-ahora') return NextResponse.json({ message: 'Acción desconocida' }, { status: 400 });
  const res = await fetch(`${API}/cta-cte/resumenes/${accion}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(await tok()) }, body: JSON.stringify(resto),
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
