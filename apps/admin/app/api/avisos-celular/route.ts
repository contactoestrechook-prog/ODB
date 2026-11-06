import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API = process.env.API_URL ?? 'http://localhost:3001';

async function conToken(): Promise<Record<string, string>> {
  const token = (await cookies()).get('odb_token')?.value;
  return { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

// Avisos al celular (6/11/2026): la clave pública (GET ?que=clave) · mis aparatos (GET) ·
// POST { accion: 'suscribir' | 'quitar' | 'quitar-aparato' | 'probar', … }
export async function GET(req: Request) {
  const que = new URL(req.url).searchParams.get('que');
  const ruta = que === 'clave' ? '/avisos-celular/clave' : '/avisos-celular/aparatos';
  const res = await fetch(`${API}${ruta}`, { headers: await conToken(), cache: 'no-store' });
  return NextResponse.json(await res.json().catch(() => ({})), { status: res.status });
}

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const ruta =
    b?.accion === 'suscribir' ? '/avisos-celular/suscribir'
      : b?.accion === 'quitar' ? '/avisos-celular/quitar'
        : b?.accion === 'quitar-aparato' ? `/avisos-celular/aparatos/${encodeURIComponent(String(b.id ?? ''))}/quitar`
          : b?.accion === 'probar' ? '/avisos-celular/probar'
            : null;
  if (!ruta) return NextResponse.json({ message: 'Acción desconocida' }, { status: 400 });
  const res = await fetch(`${API}${ruta}`, {
    method: 'POST',
    headers: await conToken(),
    body: JSON.stringify({ suscripcion: b.suscripcion, dispositivo: b.dispositivo, endpoint: b.endpoint }),
  });
  return NextResponse.json(await res.json().catch(() => ({})), { status: res.status });
}
