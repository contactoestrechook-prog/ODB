import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API = process.env.API_URL ?? 'http://localhost:3001';
async function tok(): Promise<Record<string, string>> { const t = (await cookies()).get('odb_token')?.value; return t ? { Authorization: `Bearer ${t}` } : {}; }

export async function GET(req: Request) {
  const qs = new URL(req.url).search;
  const res = await fetch(`${API}/eventos${qs}`, { headers: await tok(), cache: 'no-store' });
  return NextResponse.json(await res.json(), { status: res.status });
}

export async function POST(req: Request) {
  const res = await fetch(`${API}/eventos`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(await tok()) }, body: JSON.stringify(await req.json()),
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
