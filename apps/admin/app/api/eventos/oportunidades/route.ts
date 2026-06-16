import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API = process.env.API_URL ?? 'http://localhost:3001';

export async function GET(req: Request) {
  const t = (await cookies()).get('odb_token')?.value;
  const qs = new URL(req.url).search;
  const res = await fetch(`${API}/eventos/oportunidades${qs}`, { headers: t ? { Authorization: `Bearer ${t}` } : {}, cache: 'no-store' });
  return NextResponse.json(await res.json(), { status: res.status });
}
