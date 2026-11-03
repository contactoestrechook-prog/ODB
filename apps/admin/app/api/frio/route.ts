import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API = process.env.API_URL ?? 'http://localhost:3001';

// Frío: ?horas=24 (la pantalla) o ?planilla=1&idequipo=…&mes=AAAA-MM (Bromatología)
export async function GET(req: Request) {
  const token = (await cookies()).get('odb_token')?.value;
  const q = new URL(req.url).searchParams;
  const ruta = q.get('planilla')
    ? `/frio/planilla?idequipo=${encodeURIComponent(q.get('idequipo') ?? '')}&mes=${encodeURIComponent(q.get('mes') ?? '')}`
    : `/frio?horas=${encodeURIComponent(q.get('horas') ?? '24')}`;
  const res = await fetch(`${API}${ruta}`, { headers: token ? { Authorization: `Bearer ${token}` } : {}, cache: 'no-store' });
  return NextResponse.json(await res.json().catch(() => ({})), { status: res.status });
}
