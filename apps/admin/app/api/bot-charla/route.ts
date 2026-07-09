import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API = process.env.API_URL ?? 'http://localhost:3001';

// Simulador del bot de WhatsApp: reenvía la charla al cerebro con la sesión de staff.
export async function POST(req: Request) {
  const token = (await cookies()).get('odb_token')?.value;
  const res = await fetch(`${API}/bot/probar`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(await req.json()),
    cache: 'no-store',
  });
  return NextResponse.json(await res.json(), { status: res.status });
}

// "Nueva conversación": borra la memoria del teléfono de prueba.
export async function DELETE(req: Request) {
  const token = (await cookies()).get('odb_token')?.value;
  const u = new URL(req.url);
  const res = await fetch(
    `${API}/bot/probar?linea=${encodeURIComponent(u.searchParams.get('linea') ?? 'pedidos')}&telefono=${encodeURIComponent(u.searchParams.get('telefono') ?? '')}`,
    {
      method: 'DELETE',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      cache: 'no-store',
    },
  );
  return NextResponse.json(await res.json(), { status: res.status });
}
