import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API = process.env.API_URL ?? 'http://localhost:3001';
const auth = async (): Promise<Record<string, string>> => {
  const t = (await cookies()).get('odb_token')?.value;
  return t ? { Authorization: `Bearer ${t}` } : {};
};

export async function GET() {
  const res = await fetch(`${API}/gestion/repartidores`, { headers: await auth(), cache: 'no-store' });
  return NextResponse.json(await res.json(), { status: res.status });
}

// POST { accion, ...datos } — enruta a los endpoints del API
export async function POST(req: Request) {
  const { accion, ...d } = await req.json().catch(() => ({}));
  const ruta =
    accion === 'crear' ? '/gestion/repartidores'
    : accion === 'vehiculo' ? `/gestion/repartidores/${d.repartidorId}/vehiculos`
    : accion === 'asignar' ? `/gestion/repartidores/asignar/${d.pedidoId}`
    : null;
  if (!ruta) return NextResponse.json({ message: 'Acción inválida' }, { status: 400 });
  const { repartidorId, pedidoId, ...body } = d;
  const res = await fetch(`${API}${ruta}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await auth()) },
    body: JSON.stringify(accion === 'asignar' ? { repartidorId, ...body } : body),
  });
  return NextResponse.json(await res.json(), { status: res.status });
}

// PATCH { tipo: 'repartidor'|'vehiculo', id, ...cambios }
export async function PATCH(req: Request) {
  const { tipo, id, ...cambios } = await req.json().catch(() => ({}));
  const ruta = tipo === 'vehiculo' ? `/gestion/repartidores/vehiculos/${id}` : `/gestion/repartidores/${id}`;
  const res = await fetch(`${API}${ruta}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...(await auth()) },
    body: JSON.stringify(cambios),
  });
  return NextResponse.json(await res.json(), { status: res.status });
}

// DELETE ?vehiculoId= — desactiva un vehículo
export async function DELETE(req: Request) {
  const vid = new URL(req.url).searchParams.get('vehiculoId');
  if (!vid) return NextResponse.json({ message: 'Falta vehiculoId' }, { status: 400 });
  const res = await fetch(`${API}/gestion/repartidores/vehiculos/${vid}`, { method: 'DELETE', headers: await auth() });
  return NextResponse.json(await res.json(), { status: res.status });
}
