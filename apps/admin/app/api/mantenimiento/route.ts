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
