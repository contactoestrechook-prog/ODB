import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API = process.env.API_URL ?? 'http://localhost:3001';

async function token() {
  return (await cookies()).get('odb_token')?.value;
}

// listado para los selectores del modal (facturas de un cliente, etc.)
export async function GET(req: Request) {
  const t = await token();
  const qs = new URL(req.url).search;
  const res = await fetch(`${API}/facturacion/comprobantes${qs}`, {
    headers: t ? { Authorization: `Bearer ${t}` } : {},
    cache: 'no-store',
  });
  return NextResponse.json(await res.json(), { status: res.status });
}

// { accion: 'emitir', ...dto } | { accion: 'anular', id }
export async function POST(req: Request) {
  const t = await token();
  const { accion, ...datos } = await req.json().catch(() => ({}));
  const ruta =
    accion === 'emitir'
      ? '/facturacion/comprobantes'
      : accion === 'anular'
        ? `/facturacion/comprobantes/${datos.id}/anular`
        : null;
  if (!ruta) return NextResponse.json({ message: 'Acción inválida' }, { status: 400 });
  const res = await fetch(`${API}${ruta}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(t ? { Authorization: `Bearer ${t}` } : {}),
    },
    body: JSON.stringify(datos),
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
