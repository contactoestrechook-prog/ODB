import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API = process.env.API_URL ?? 'http://localhost:3001';

export async function GET(req: Request) {
  const token = (await cookies()).get('odb_token')?.value;
  const recurso = new URL(req.url).searchParams.get('recurso') === 'preparadores' ? 'preparadores' : 'cajeros';
  const res = await fetch(`${API}/eficiencia/${recurso}`, { headers: token ? { Authorization: `Bearer ${token}` } : {}, cache: 'no-store' });
  return NextResponse.json(await res.json(), { status: res.status });
}
