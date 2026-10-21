import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API = process.env.API_URL ?? 'http://localhost:3001';

// { repartidorId } asigna quién lleva el envío; vacío o null se lo saca.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = (await cookies()).get('odb_token')?.value;
  const body = await req.json().catch(() => ({}));
  const res = await fetch(`${API}/pedidos/${encodeURIComponent(id)}/repartidor`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) },
    body: JSON.stringify({ repartidorId: body?.repartidorId || null }),
  }).catch(() => null);
  if (!res) return NextResponse.json({ message: 'No pude comunicarme con la API' }, { status: 502 });
  // antes un error que no fuera JSON rompía esta ruta con un 500 sin mensaje
  const datos = await res.json().catch(() => ({ message: 'La API no respondió bien' }));
  return NextResponse.json(datos, { status: res.status });
}
