import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

// La app de RESPONDE (la de MetoGroup, tal cual) habla con este proxy, que la
// conecta al RESPONDE de ODB. La sesión de ODB es la puerta: si estás logueado
// en el panel, la app entra derecho, sin otra contraseña. La app espera el
// contrato GET ?data=1 / POST {accion}; el adaptador del API se lo da.
const API = process.env.API_URL ?? 'http://localhost:3001';

import { datosDesdeToken } from '../../lib/permisos';

async function auth(): Promise<Record<string, string> | null> {
  const token = (await cookies()).get('odb_token')?.value;
  if (!token) return null;
  // RESPONDE es de los dueños. El API verifica la firma; esto corta antes.
  if (datosDesdeToken(token).rol !== 'dueno') return null;
  return { Authorization: `Bearer ${token}` };
}

export async function GET(req: Request) {
  const headers = await auth();
  // la app interpreta 401 como "sesión vencida" y muestra su login: acá no
  // aplica, así que se manda a loguear en ODB
  if (!headers) return NextResponse.json({ error: 'Sesión de ODB vencida' }, { status: 401 });
  const url = new URL(req.url);
  const qs = new URLSearchParams(url.search);
  qs.delete('key'); qs.delete('token'); // credenciales de la app original: acá no se usan
  const cola = qs.toString();
  const res = await fetch(`${API}/responde-app${cola ? `?${cola}` : ''}`, { headers, cache: 'no-store' });
  return new NextResponse(await res.text(), { status: res.status, headers: { 'content-type': 'application/json' } });
}

export async function POST(req: Request) {
  const headers = await auth();
  if (!headers) return NextResponse.json({ error: 'Sesión de ODB vencida' }, { status: 401 });
  const cuerpo = await req.text();
  const res = await fetch(`${API}/responde-app`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: cuerpo,
    cache: 'no-store',
  });
  const texto = await res.text();
  // la app espera {ok:true} o {ok:false, error}; los errores de Nest vienen como {message}
  try {
    const j = JSON.parse(texto);
    if (!res.ok) return NextResponse.json({ ok: false, error: j?.message ?? 'Error' }, { status: 200 });
    return NextResponse.json({ ok: true, ...j }, { status: 200 });
  } catch {
    return NextResponse.json({ ok: false, error: `Respuesta inválida (${res.status})` }, { status: 200 });
  }
}
