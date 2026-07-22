import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API = process.env.API_URL ?? 'http://localhost:3001';

// GET ?mes=YYYY-MM | ?desde=YYYY-MM-DD&hasta=YYYY-MM-DD | ?recurso=anual&anio=YYYY
export async function GET(req: Request) {
  const token = (await cookies()).get('odb_token')?.value;
  const sp = new URL(req.url).searchParams;
  const qs = new URLSearchParams();
  for (const k of ['mes', 'desde', 'hasta', 'anio']) {
    const v = sp.get(k);
    if (v) qs.set(k, v);
  }
  const ruta = sp.get('recurso') === 'anual' ? '/contable/anual' : '/contable';
  const res = await fetch(`${API}${ruta}${qs.size ? `?${qs}` : ''}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    cache: 'no-store',
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
