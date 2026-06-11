import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API = process.env.API_URL ?? 'http://localhost:3001';

export async function POST(req: Request) {
  const token = (await cookies()).get('odb_token')?.value;
  const form = await req.formData();
  const sku = form.get('sku') as string;
  const res = await fetch(`${API}/productos/${encodeURIComponent(sku)}/imagen`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
