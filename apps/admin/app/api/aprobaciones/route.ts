import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API = process.env.API_URL ?? 'http://localhost:3001';

async function conToken(): Promise<Record<string, string>> {
  const token = (await cookies()).get('odb_token')?.value;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// Bandeja única de aprobaciones. Quién firma lo decide el API a partir del
// token; desde acá solo viaja la decisión y el motivo.
export async function GET() {
  const res = await fetch(`${API}/aprobaciones`, { headers: await conToken(), cache: 'no-store' });
  if (!res.ok) console.warn('[api/aprobaciones] →', res.status);
  return NextResponse.json(await res.json(), { status: res.status });
}

export async function POST(req: Request) {
  const { tipo, id, decision, motivo } = await req.json().catch(() => ({}));
  if (!tipo || !id || !['aprobar', 'rechazar'].includes(decision)) {
    return NextResponse.json({ message: 'Pedido incompleto' }, { status: 400 });
  }
  const res = await fetch(`${API}/aprobaciones/${encodeURIComponent(tipo)}/${encodeURIComponent(id)}/${decision}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await conToken()) },
    body: JSON.stringify({ motivo }),
  });
  if (!res.ok) console.warn('[api/aprobaciones]', tipo, decision, '→', res.status);
  return NextResponse.json(await res.json(), { status: res.status });
}
