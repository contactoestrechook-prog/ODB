import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API = process.env.API_URL ?? 'http://localhost:3001';

async function proxy(metodo: string, ruta: string, cuerpo?: any) {
  const token = (await cookies()).get('odb_token')?.value;
  const res = await fetch(`${API}${ruta}`, {
    method: metodo,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(cuerpo !== undefined ? { body: JSON.stringify(cuerpo) } : {}),
  });
  return NextResponse.json(await res.json(), { status: res.status });
}

export async function POST(req: Request) {
  return proxy('POST', '/usuarios', await req.json().catch(() => ({})));
}

// edición: { id, ...cambios }
export async function PATCH(req: Request) {
  const { id, ...cambios } = await req.json().catch(() => ({}));
  return proxy('PATCH', `/usuarios/${id}`, cambios);
}
