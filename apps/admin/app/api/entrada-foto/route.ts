import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API = process.env.API_URL ?? 'http://localhost:3001';

// Foto de la factura/remito → extracción con IA (proveedor, renglones, impuestos).
// La lectura corre en SEGUNDO PLANO: el POST devuelve un id al instante y la
// pantalla pregunta por el resultado con el GET. Una factura grande tarda
// minutos y el gateway corta la conexión a los cinco.
export async function POST(req: Request) {
  const token = (await cookies()).get('odb_token')?.value;
  const form = await req.formData();
  const res = await fetch(`${API}/compras/entrada-foto`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  return NextResponse.json(await res.json(), { status: res.status });
}

export async function GET(req: Request) {
  const token = (await cookies()).get('odb_token')?.value;
  const id = new URL(req.url).searchParams.get('id') ?? '';
  const res = await fetch(`${API}/compras/entrada-foto/${encodeURIComponent(id)}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    cache: 'no-store',
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
