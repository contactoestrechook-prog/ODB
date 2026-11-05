import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API = process.env.API_URL ?? 'http://localhost:3001';

// Nota de un ticket ya cobrado: texto y/o audio (en base64). Quién la escribió
// lo pone la API con la sesión, no el panel.
export async function POST(req: Request) {
  const { ventaId, ...dto } = await req.json().catch(() => ({ ventaId: '' }));
  if (!ventaId) return NextResponse.json({ message: 'Falta la venta' }, { status: 400 });
  const token = (await cookies()).get('odb_token')?.value;
  const res = await fetch(`${API}/ventas/${encodeURIComponent(ventaId)}/notas`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(dto),
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
