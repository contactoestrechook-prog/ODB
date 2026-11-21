import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API = process.env.API_URL ?? 'http://localhost:3001';

// LA PREGUNTA DE UN CLIENTE EN LA CAJA (21/11/2026): lo que el bot no sabe suena en
// la caja y se contesta ahí mismo (ver ui/AvisoPreguntaCliente.tsx).
async function reenviar(ruta: string, init: RequestInit = {}) {
  const token = (await cookies()).get('odb_token')?.value;
  const res = await fetch(`${API}${ruta}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    cache: 'no-store',
  });
  return NextResponse.json(await res.json().catch(() => ({ message: 'La API no respondió bien' })), { status: res.status });
}

export async function GET() {
  return reenviar('/bot/consultas-caja');
}

// POST { accion: 'responder', id, texto } | { accion: 'cerrar', id }
export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  const id = encodeURIComponent(String(b?.id ?? ''));
  if (b?.accion === 'responder') return reenviar(`/bot/consultas-caja/${id}/responder`, { method: 'POST', body: JSON.stringify({ texto: String(b?.texto ?? '') }) });
  if (b?.accion === 'cerrar') return reenviar(`/bot/consultas-caja/${id}/cerrar`, { method: 'POST', body: '{}' });
  return NextResponse.json({ message: 'Acción desconocida' }, { status: 400 });
}
