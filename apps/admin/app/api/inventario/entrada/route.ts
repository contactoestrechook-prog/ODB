import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API = process.env.API_URL ?? 'http://localhost:3001';

// La entrada de «Inventario de producto» (13/11/2026): cuánto alcanza el stock
// en cada sucursal y las listas para recorrer. Se pide aparte de la página: la
// primera lectura del motor tarda unos segundos y el buscador no la espera.
export async function GET(req: Request) {
  const token = (await cookies()).get('odb_token')?.value;
  const entrada = new URL(req.url).searchParams;
  const sp = new URLSearchParams();
  for (const k of ['sucursal', 'vista', 'desde']) {
    const v = entrada.get(k);
    if (v) sp.set(k, v);
  }
  const res = await fetch(`${API}/inventario/entrada?${sp}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    cache: 'no-store',
  });
  return NextResponse.json(await res.json().catch(() => ({})), { status: res.status });
}
