import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API = process.env.API_URL ?? 'http://localhost:3001';

// Sube la póliza (multipart) al API. Espera FormData con 'archivo' y 'vehiculoId'.
export async function POST(req: Request) {
  const t = (await cookies()).get('odb_token')?.value;
  const form = await req.formData();
  const vid = String(form.get('vehiculoId') ?? '');
  const archivo = form.get('archivo');
  if (!vid || !archivo) return NextResponse.json({ message: 'Faltan datos de la póliza' }, { status: 400 });
  const fd = new FormData();
  fd.append('archivo', archivo as Blob);
  const res = await fetch(`${API}/gestion/repartidores/vehiculos/${vid}/poliza`, {
    method: 'POST',
    headers: t ? { Authorization: `Bearer ${t}` } : {},
    body: fd,
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
