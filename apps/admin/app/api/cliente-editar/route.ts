import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API = process.env.API_URL ?? 'http://localhost:3001';

// edición de cliente: { id, ...cambios }
export async function PATCH(req: Request) {
  const token = (await cookies()).get('odb_token')?.value;
  const { id, ...cambios } = await req.json().catch(() => ({}));
  const res = await fetch(`${API}/clientes/${id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(cambios),
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
