import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API = process.env.API_URL ?? 'http://localhost:3001';

// El somelier del panel (13/11/2026): la charla del vendedor, el local y los
// vinos que está mirando. Con la sesión del panel (el de la web es público).
export async function POST(req: Request) {
  const token = (await cookies()).get('odb_token')?.value;
  const body = await req.json().catch(() => ({}));
  const res = await fetch(`${API}/sommelier/vendedor`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body ?? {}),
  });
  return NextResponse.json(await res.json().catch(() => ({})), { status: res.status });
}
