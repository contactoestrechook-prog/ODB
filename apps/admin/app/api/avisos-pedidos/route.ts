import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API = process.env.API_URL ?? 'http://localhost:3001';

// Pedidos cuyo aviso a administración no salió o no llegó (3/10/2026)
export async function GET() {
  const token = (await cookies()).get('odb_token')?.value;
  if (!token) return NextResponse.json({ problemas: [] });
  const res = await fetch(`${API}/avisos/pedidos`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' }).catch(() => null);
  if (!res?.ok) return NextResponse.json({ problemas: [] });
  return NextResponse.json(await res.json());
}
