import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API = process.env.API_URL ?? 'http://localhost:3001';

// Foto de la factura/remito → extracción con IA (proveedor, renglones, impuestos)
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
