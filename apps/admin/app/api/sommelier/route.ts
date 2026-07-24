import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API = process.env.API_URL ?? 'http://localhost:3001';

// El chat del somelier va por acá (como el resto del panel) en vez de pegarle
// a la API desde el navegador: sin CORS y sin exponer la URL de la API.
export async function POST(req: Request) {
  const token = (await cookies()).get('odb_token')?.value;
  const body = await req.json().catch(() => ({}));
  const res = await fetch(`${API}/sommelier/charla`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body ?? {}),
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
