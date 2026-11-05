import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API = process.env.API_URL ?? 'http://localhost:3001';

async function reenviar(ruta: string, init: RequestInit = {}) {
  const token = (await cookies()).get('odb_token')?.value;
  const res = await fetch(`${API}${ruta}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    cache: 'no-store',
  });
  return NextResponse.json(await res.json().catch(() => ({})), { status: res.status });
}
const idEq = (v: unknown) => (typeof v === 'string' && /^\d{1,9}$/.test(v) ? v : null);

// Frío: ?horas=24 (la pantalla) o ?planilla=1&idequipo=…&mes=AAAA-MM (Bromatología)
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  return reenviar(q.get('planilla')
    ? `/frio/planilla?idequipo=${encodeURIComponent(q.get('idequipo') ?? '')}&mes=${encodeURIComponent(q.get('mes') ?? '')}`
    : `/frio?horas=${encodeURIComponent(q.get('horas') ?? '24')}`);
}

// La ficha de cada equipo (4/11/2026). JSON { accion: 'editar' | 'sumar' | 'quitar', idequipo, … }
export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  if (b?.accion === 'sumar') return reenviar('/frio/equipos', { method: 'POST', body: JSON.stringify({ idequipo: b.idequipo, nombre: b.nombre }) });
  const id = idEq(b?.idequipo);
  if (!id) return NextResponse.json({ message: 'Falta el equipo' }, { status: 400 });
  if (b.accion === 'quitar') return reenviar(`/frio/equipos/${id}`, { method: 'DELETE' });
  if (b.accion === 'editar') return reenviar(`/frio/equipos/${id}`, { method: 'PATCH', body: JSON.stringify(b.cambios ?? {}) });
  return NextResponse.json({ message: 'Acción desconocida' }, { status: 400 });
}
