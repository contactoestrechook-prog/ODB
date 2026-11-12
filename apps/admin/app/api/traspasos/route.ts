import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API = process.env.API_URL ?? 'http://localhost:3001';

// Traspasos entre locales (10/11/2026): pasa a la API tal cual.
//   GET  /api/traspasos?p=sugerencias&origen=…&destino=…   (p vacío = la lista)
//   POST /api/traspasos  { p: 'pedir' | 'enviar' | '<id>/enviar' | '<id>/recibir' | …, ...cuerpo }
const RUTA_VALIDA = /^([0-9a-f-]{36}\/)?(pedir|enviar|recibir|resolver|anular|entregado|sugerencias|para-llevar)?$/;

async function pasar(metodo: 'GET' | 'POST', ruta: string, cuerpo?: unknown) {
  const token = (await cookies()).get('odb_token')?.value;
  if (!token) return NextResponse.json({ message: 'Volvé a entrar al sistema' }, { status: 401 });
  const res = await fetch(`${API}/traspasos${ruta}`, {
    method: metodo,
    headers: { Authorization: `Bearer ${token}`, ...(cuerpo ? { 'Content-Type': 'application/json' } : {}) },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    cache: 'no-store',
  });
  const datos = await res.json().catch(() => ({ message: 'La API no respondió bien' }));
  return NextResponse.json(datos, { status: res.status });
}

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const p = q.get('p') ?? '';
  if (!RUTA_VALIDA.test(p)) return NextResponse.json({ message: 'Ruta inválida' }, { status: 400 });
  q.delete('p');
  return pasar('GET', `${p ? `/${p}` : ''}${q.toString() ? `?${q}` : ''}`);
}

export async function POST(req: Request) {
  const { p, ...cuerpo } = await req.json().catch(() => ({}));
  if (!p || !RUTA_VALIDA.test(String(p))) return NextResponse.json({ message: 'Ruta inválida' }, { status: 400 });
  return pasar('POST', `/${p}`, cuerpo);
}
