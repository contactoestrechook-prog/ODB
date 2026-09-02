import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API = process.env.API_URL ?? 'http://localhost:3001';

// Fraccionamiento (caso huevos): GET lista los grupos madre + fracciones con
// stock; POST arma o desarma fracciones contra el pozo madre.
export async function GET() {
  const token = (await cookies()).get('odb_token')?.value;
  const res = await fetch(`${API}/stock/fraccionables`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    cache: 'no-store',
  });
  return NextResponse.json(await res.json(), { status: res.status });
}

export async function POST(req: Request) {
  const token = (await cookies()).get('odb_token')?.value;
  const body = await req.json();
  const res = await fetch(`${API}/stock/fraccionar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
