import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API = process.env.API_URL ?? 'http://localhost:3001';

export async function GET(req: Request) {
  const token = (await cookies()).get('odb_token')?.value;
  const mes = new URL(req.url).searchParams.get('mes') ?? '';
  const res = await fetch(`${API}/contable${mes ? `?mes=${encodeURIComponent(mes)}` : ''}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    cache: 'no-store',
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
