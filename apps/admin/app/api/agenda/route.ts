import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API = process.env.API_URL ?? 'http://localhost:3001';

// los contactos de WhatsApp: ?buscar, ?tipo=clientes|proveedores|equipo, ?pagina
export async function GET(req: Request) {
  const token = (await cookies()).get('odb_token')?.value;
  const qs = new URL(req.url).searchParams.toString();
  const res = await fetch(`${API}/agenda${qs ? `?${qs}` : ''}`, { headers: token ? { Authorization: `Bearer ${token}` } : {}, cache: 'no-store' });
  return NextResponse.json(await res.json(), { status: res.status });
}
