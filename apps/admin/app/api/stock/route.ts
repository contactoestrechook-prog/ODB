import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API = process.env.API_URL ?? 'http://localhost:3001';

// Estadísticas y consultas: GET ?recurso=negativos|abc|sin-rotacion|movimientos|valorizacion (+ filtros)
const RECURSOS = ['resumen', 'valorizacion', 'negativos', 'abc', 'sin-rotacion', 'movimientos', 'bajo-minimo'];
export async function GET(req: Request) {
  const token = (await cookies()).get('odb_token')?.value;
  const url = new URL(req.url);
  const recurso = url.searchParams.get('recurso') ?? '';
  if (!RECURSOS.includes(recurso)) return NextResponse.json({ message: 'Recurso inválido' }, { status: 400 });
  url.searchParams.delete('recurso');
  const qs = url.searchParams.toString();
  const res = await fetch(`${API}/stock/${recurso}${qs ? `?${qs}` : ''}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    cache: 'no-store',
  });
  return NextResponse.json(await res.json(), { status: res.status });
}

// Operaciones de stock: { accion: 'ajuste'|'merma'|'transferencia'|'recibir', ...datos }
export async function POST(req: Request) {
  const token = (await cookies()).get('odb_token')?.value;
  const { accion, ...datos } = await req.json().catch(() => ({}));
  const ruta =
    accion === 'ajuste' ? '/stock/ajustes'
    : accion === 'merma' ? '/stock/mermas'
    : accion === 'transferencia' ? '/stock/transferencias'
    : accion === 'recibir' ? `/stock/transferencias/${datos.transferenciaId}/recibir`
    : null;
  if (!ruta) return NextResponse.json({ message: 'Acción inválida' }, { status: 400 });

  const res = await fetch(`${API}${ruta}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(datos),
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
