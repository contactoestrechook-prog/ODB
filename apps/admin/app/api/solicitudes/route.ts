import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API = process.env.API_URL ?? 'http://localhost:3001';

async function conToken(): Promise<Record<string, string>> {
  const token = (await cookies()).get('odb_token')?.value;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function GET(req: Request) {
  const qs = new URL(req.url).search;
  const res = await fetch(`${API}/solicitudes${qs}`, { headers: await conToken(), cache: 'no-store' });
  return NextResponse.json(await res.json(), { status: res.status });
}
