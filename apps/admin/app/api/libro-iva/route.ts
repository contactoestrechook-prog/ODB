import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API = process.env.API_URL ?? 'http://localhost:3001';

export async function GET(req: Request) {
  const t = (await cookies()).get('odb_token')?.value;
  const periodo = new URL(req.url).searchParams.get('periodo') ?? '';
  const res = await fetch(`${API}/facturacion/libro-iva${periodo ? `?periodo=${periodo}` : ''}`, {
    headers: t ? { Authorization: `Bearer ${t}` } : {},
    cache: 'no-store',
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
