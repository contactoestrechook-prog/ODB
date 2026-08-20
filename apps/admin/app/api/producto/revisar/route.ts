import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API = process.env.API_URL ?? 'http://localhost:3001';

// Chequeo previo al alta: si el código de barras ya es de otro producto, o hay
// uno que se llama casi igual, se avisa mientras escriben. Es POST porque en el
// API 'productos/:sku' es una ruta pública que se comería 'productos/revisar'.
export async function POST(req: Request) {
  const token = (await cookies()).get('odb_token')?.value;
  const res = await fetch(`${API}/productos/revisar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(await req.json().catch(() => ({}))),
    cache: 'no-store',
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
