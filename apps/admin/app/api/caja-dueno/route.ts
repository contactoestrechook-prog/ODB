import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API = process.env.API_URL ?? 'http://localhost:3001';

// Caja del dueño (25/11/2026): la hoja y sus renglones. La API decide quién la ve.
async function auth(): Promise<Record<string, string>> {
  const token = (await cookies()).get('odb_token')?.value;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function reenviar(ruta: string, init: RequestInit = {}) {
  const res = await fetch(`${API}${ruta}`, { ...init, headers: { ...(await auth()), ...(init.body ? { 'Content-Type': 'application/json' } : {}) }, cache: 'no-store' });
  return NextResponse.json(await res.json().catch(() => ({})), { status: res.status });
}

// ?desde=AAAA-MM-DD&hasta=AAAA-MM-DD (sin nada: toda la hoja)
export async function GET(req: Request) {
  const u = new URL(req.url);
  const p = new URLSearchParams();
  for (const k of ['desde', 'hasta']) {
    const v = u.searchParams.get(k);
    if (v && /^\d{4}-\d{2}-\d{2}$/.test(v)) p.set(k, v);
  }
  return reenviar(`/caja-dueno${p.size ? `?${p.toString()}` : ''}`);
}

// { accion: 'crear' | 'editar' | 'borrar' | 'cuadro-crear' | 'cuadro-renombrar' | 'cuadro-quitar', id?, ...datos }
export async function POST(req: Request) {
  const { accion, id, ...datos } = (await req.json().catch(() => ({}))) as { accion?: string; id?: string } & Record<string, unknown>;
  const idSeguro = encodeURIComponent(String(id ?? ''));
  switch (accion) {
    case 'crear':
      return reenviar('/caja-dueno/movimientos', { method: 'POST', body: JSON.stringify(datos) });
    case 'editar':
      return reenviar(`/caja-dueno/movimientos/${idSeguro}`, { method: 'PATCH', body: JSON.stringify(datos) });
    case 'borrar':
      return reenviar(`/caja-dueno/movimientos/${idSeguro}`, { method: 'DELETE' });
    case 'cuadro-crear':
      return reenviar('/caja-dueno/cuadros', { method: 'POST', body: JSON.stringify(datos) });
    case 'cuadro-renombrar':
      return reenviar(`/caja-dueno/cuadros/${idSeguro}`, { method: 'PATCH', body: JSON.stringify(datos) });
    case 'cuadro-quitar':
      return reenviar(`/caja-dueno/cuadros/${idSeguro}`, { method: 'DELETE' });
    default:
      return NextResponse.json({ message: 'Acción desconocida' }, { status: 400 });
  }
}
