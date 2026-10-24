import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API = process.env.API_URL ?? 'http://localhost:3001';

// ?tipo=sponsor: las cuentas de los sponsors del Wine Fest
export async function GET(req: Request) {
  const token = (await cookies()).get('odb_token')?.value;
  const tipo = new URL(req.url).searchParams.get('tipo') === 'sponsor' ? '?tipo=sponsor' : '';
  const res = await fetch(`${API}/cta-cte/tablero${tipo}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    cache: 'no-store',
  });
  return NextResponse.json(await res.json(), { status: res.status });
}

// edición del tope de crédito de un cliente (reusa el PATCH de clientes)
export async function POST(req: Request) {
  const token = (await cookies()).get('odb_token')?.value;
  const { clienteId, limiteCredito } = await req.json().catch(() => ({}));
  if (!clienteId) return NextResponse.json({ message: 'Falta el cliente' }, { status: 400 });
  const res = await fetch(`${API}/clientes/${encodeURIComponent(clienteId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ limiteCredito: Number(limiteCredito) || 0 }),
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
