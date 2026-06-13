import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API = process.env.API_URL ?? 'http://localhost:3001';

// Autocompletar de clientes para el emisor de comprobantes
export async function GET(req: Request) {
  const token = (await cookies()).get('odb_token')?.value;
  const q = new URL(req.url).searchParams.get('q') ?? '';
  const res = await fetch(`${API}/clientes?buscar=${encodeURIComponent(q)}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    cache: 'no-store',
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
