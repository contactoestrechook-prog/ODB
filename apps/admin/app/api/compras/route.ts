import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API = process.env.API_URL ?? 'http://localhost:3001';

function subDe(token?: string): string | null {
  if (!token) return null;
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
    return payload.sub ?? null;
  } catch {
    return null;
  }
}

const GET_RECURSOS: Record<string, string> = {
  resumen: '/compras/resumen', ordenes: '/compras/ordenes', sugerencias: '/compras/sugerencias',
  deuda: '/compras/deuda', 'ordenes-pago': '/compras/ordenes-pago', proveedores: '/proveedores',
};

export async function GET(req: Request) {
  const token = (await cookies()).get('odb_token')?.value;
  const recurso = new URL(req.url).searchParams.get('recurso') ?? '';
  const ruta = GET_RECURSOS[recurso];
  if (!ruta) return NextResponse.json({ message: 'Recurso inválido' }, { status: 400 });
  const res = await fetch(`${API}${ruta}`, { headers: token ? { Authorization: `Bearer ${token}` } : {}, cache: 'no-store' });
  return NextResponse.json(await res.json(), { status: res.status });
}

// POST { accion, ...datos } — inyecta usuarioId del token donde hace falta
export async function POST(req: Request) {
  const token = (await cookies()).get('odb_token')?.value;
  const usuarioId = subDe(token);
  const { accion, ...d } = await req.json().catch(() => ({}));

  let metodo = 'POST';
  let ruta: string | null = null;
  let body: any = d;

  switch (accion) {
    case 'crearOC': ruta = '/compras/ordenes'; body = { ...d, usuarioId }; break;
    case 'aprobar': ruta = `/compras/ordenes/${d.id}/aprobar`; body = { pin: d.pin, usuarioId }; break;
    case 'rechazar': ruta = `/compras/ordenes/${d.id}/rechazar`; body = { motivo: d.motivo, usuarioId }; break;
    case 'recibir': ruta = `/compras/ordenes/${d.id}/recibir`; body = { items: d.items, usuarioId, margenPct: d.margenPct }; break;
    case 'crearProveedor': ruta = '/proveedores'; break;
    case 'editarProveedor': ruta = `/proveedores/${d.id}`; metodo = 'PATCH'; break;
    case 'factura': ruta = '/compras/facturas'; break;
    case 'crearOP': ruta = '/compras/ordenes-pago'; body = { ...d, usuarioId }; break;
    case 'aprobarOP': ruta = `/compras/ordenes-pago/${d.id}/aprobar`; body = { usuarioId }; break;
    case 'rechazarOP': ruta = `/compras/ordenes-pago/${d.id}/rechazar`; body = { motivo: d.motivo, usuarioId }; break;
    case 'pagarOP': ruta = `/compras/ordenes-pago/${d.id}/pagar`; body = { usuarioId, chequesPropios: d.chequesPropios, chequesTercerosIds: d.chequesTercerosIds }; break;
    default: return NextResponse.json({ message: 'Acción inválida' }, { status: 400 });
  }

  const res = await fetch(`${API}${ruta}`, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
