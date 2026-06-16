import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API = process.env.API_URL ?? 'http://localhost:3001';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = (await cookies()).get('odb_token')?.value;
  const res = await fetch(`${API}/eventos/${id}/enviar`, {
    method: 'POST', headers: t ? { Authorization: `Bearer ${t}` } : {},
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
