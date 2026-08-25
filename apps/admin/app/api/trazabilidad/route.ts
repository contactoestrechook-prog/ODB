import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API = process.env.API_URL ?? 'http://localhost:3001';

// Trazabilidad de administración: libro de documentos, cadena de una compra y
// los huecos (pasos que quedaron sin cerrar).
export async function GET(req: Request) {
  const token = (await cookies()).get('odb_token')?.value;
  const url = new URL(req.url);
  const vista = url.searchParams.get('vista') ?? 'huecos';
  let ruta = '/documentos/huecos';
  if (vista === 'libro') ruta = `/documentos?tipo=${encodeURIComponent(url.searchParams.get('tipo') ?? '')}`;
  else if (vista === 'cadena') ruta = `/documentos/cadena/${encodeURIComponent(url.searchParams.get('ocId') ?? '')}`;

  const res = await fetch(`${API}${ruta}`, { headers: token ? { Authorization: `Bearer ${token}` } : {}, cache: 'no-store' });
  if (!res.ok) console.warn('[api/trazabilidad]', ruta, '→', res.status);
  return NextResponse.json(await res.json(), { status: res.status });
}
