import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API = process.env.API_URL ?? 'http://localhost:3001';

export async function POST(req: Request) {
  const { sku, nombre, porcentaje, dias } = await req.json();
  const token = (await cookies()).get('odb_token')?.value;
  const res = await fetch(`${API}/descuentos`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      nombre: `Liquidación ${nombre} −${porcentaje} %`,
      alcance: 'producto',
      tipo: 'porcentaje',
      valor: porcentaje,
      desde: new Date().toISOString(),
      hasta: new Date(Date.now() + (dias ?? 10) * 86400_000).toISOString(),
      sku,
    }),
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
