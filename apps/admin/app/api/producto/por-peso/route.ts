import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API = process.env.API_URL ?? 'http://localhost:3001';

// { sku } → cómo está · { sku, porPeso } → lo cambia (con auditoría)
export async function POST(req: Request) {
  const token = (await cookies()).get('odb_token')?.value;
  const res = await fetch(`${API}/productos/por-peso`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(await req.json().catch(() => ({}))),
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
