import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API = process.env.API_URL ?? 'http://localhost:3001';

// Mantenimiento (9/11/2026): los trabajos publicados y las horas del abono.
export async function GET() {
  const token = (await cookies()).get('odb_token')?.value;
  if (!token) return NextResponse.json({ message: 'Volvé a entrar al sistema' }, { status: 401 });
  const res = await fetch(`${API}/mantenimiento`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
  const datos = await res.json().catch(() => ({ message: 'La API no respondió bien' }));
  return NextResponse.json(datos, { status: res.status });
}

// Aprobar o rechazar una cotización de horas extra: { id, decision, motivo }
export async function POST(req: Request) {
  const token = (await cookies()).get('odb_token')?.value;
  if (!token) return NextResponse.json({ message: 'Volvé a entrar al sistema' }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  if (!b?.id || !['aprobar', 'rechazar'].includes(b?.decision)) return NextResponse.json({ message: 'Falta qué cotización y qué decisión' }, { status: 400 });
  const res = await fetch(`${API}/mantenimiento/cotizaciones/${encodeURIComponent(b.id)}/${b.decision}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ motivo: b.motivo ?? null }),
  });
  const datos = await res.json().catch(() => ({ message: 'La API no respondió bien' }));
  return NextResponse.json(datos, { status: res.status });
}
