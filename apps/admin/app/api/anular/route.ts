import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API = process.env.API_URL ?? 'http://localhost:3001';

export async function POST(req: Request) {
  const { ventaId } = await req.json();
  const token = (await cookies()).get('odb_token')?.value;
  const res = await fetch(`${API}/ventas/${encodeURIComponent(ventaId)}/anular`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
