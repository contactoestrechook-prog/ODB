import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API = process.env.API_URL ?? 'http://localhost:3001';

export async function GET(req: Request) {
  const token = (await cookies()).get('odb_token')?.value;
  const url = new URL(req.url);
  const recurso = url.searchParams.get('recurso') ?? 'listar';
  const ruta = recurso === 'audiencia'
    ? `/difusiones/audiencia?segmento=${url.searchParams.get('segmento') ?? ''}&soloComunidad=${url.searchParams.get('soloComunidad') ?? ''}`
    : '/difusiones';
  const res = await fetch(`${API}${ruta}`, { headers: token ? { Authorization: `Bearer ${token}` } : {}, cache: 'no-store' });
  return NextResponse.json(await res.json(), { status: res.status });
}

// POST { accion: 'redactar'|'crear', ...datos }
export async function POST(req: Request) {
  const token = (await cookies()).get('odb_token')?.value;
  const { accion, ...datos } = await req.json().catch(() => ({}));
  const ruta = accion === 'redactar' ? '/difusiones/redactar' : '/difusiones';
  const res = await fetch(`${API}${ruta}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(datos),
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
