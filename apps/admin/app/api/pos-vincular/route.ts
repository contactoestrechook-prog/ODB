import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API = process.env.API_URL ?? 'http://localhost:3001';

// La cajera vincula, desde la caja, un código de barras que el sistema no conocía.
export async function POST(req: Request) {
  const token = (await cookies()).get('odb_token')?.value;
  const body = await req.json().catch(() => ({}));
  const res = await fetch(`${API}/pos/vincular-codigo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return NextResponse.json(await res.json().catch(() => ({})), { status: res.status });
}
