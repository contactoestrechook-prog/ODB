import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API = process.env.API_URL ?? 'http://localhost:3001';

// 2/10/2026: la charla lee el motor de abastecimiento entero (~9 páginas)
// antes de llamar al modelo; sin esto Next puede cortar con un 504
export const maxDuration = 120;

export async function POST(req: Request) {
  const token = (await cookies()).get('odb_token')?.value;
  const res = await fetch(`${API}/analista/charla`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(await req.json()),
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
