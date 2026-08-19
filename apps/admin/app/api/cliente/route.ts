import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API = process.env.API_URL ?? 'http://localhost:3001';

export async function GET(req: Request) {
  const dni = new URL(req.url).searchParams.get('dni');
  const token = (await cookies()).get('odb_token')?.value;
  const res = await fetch(`${API}/ventas/cliente/${encodeURIComponent(dni ?? '')}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  return NextResponse.json(await res.json(), { status: res.status });
}

// Alta del WhatsApp del cliente + su permiso para recibir novedades, desde la caja
export async function POST(req: Request) {
  const token = (await cookies()).get('odb_token')?.value;
  const { dni, telefono, acepta } = await req.json().catch(() => ({}) as any);
  if (!dni) return NextResponse.json({ message: 'Falta el DNI' }, { status: 400 });
  const res = await fetch(`${API}/ventas/cliente/${encodeURIComponent(dni)}/whatsapp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ telefono, acepta }),
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
