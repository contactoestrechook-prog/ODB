import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

// El proveedor de cada producto y el cambio desde cualquier pantalla
// (18/11/2026, Leandro: «tenemos que poder cambiar un producto de proveedor
// desde cualquier lado»). Lo usa el botón «Proveedor: X · cambiar»
// (app/ui/CambiarProveedor.tsx). Solo deja pasar estas acciones; la seguridad
// real está en el API (@Roles).
const API = process.env.API_URL ?? 'http://localhost:3001';
const BASE = '/proveedor-de-producto';

async function reenviar(ruta: string, init: RequestInit = {}) {
  const t = (await cookies()).get('odb_token')?.value;
  const res = await fetch(`${API}${BASE}${ruta}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) },
    cache: 'no-store',
  });
  if (!res.ok) console.warn('[api/proveedor-producto]', init.method ?? 'GET', ruta, '→', res.status);
  return NextResponse.json(await res.json().catch(() => ({})), { status: res.status });
}

const id = (v: unknown) => (typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v) ? v : null);

// GET ?recurso=proveedores → los proveedores activos (para el buscador)
// GET ?de=<proveedorId>     → lo que trabaja ese proveedor, con el proveedor de hoy de cada producto
export async function GET(req: Request) {
  const u = new URL(req.url);
  const de = id(u.searchParams.get('de'));
  if (de) return reenviar(`/de/${de}`);
  if (u.searchParams.get('recurso') === 'proveedores') return reenviar('/proveedores');
  return NextResponse.json({ message: 'Recurso desconocido' }, { status: 400 });
}

// POST { accion: 'actuales', refs }                         → el proveedor de hoy de cada producto (id o SKU)
// POST { accion: 'reasignar', producto, proveedorId, pantalla } → pasarlo a otro proveedor
export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  if (b?.accion === 'actuales') {
    return reenviar('/actuales', { method: 'POST', body: JSON.stringify({ refs: Array.isArray(b.refs) ? b.refs.slice(0, 500) : [] }) });
  }
  if (b?.accion === 'reasignar') {
    return reenviar('/reasignar', { method: 'POST', body: JSON.stringify({ producto: b.producto, proveedorId: b.proveedorId, pantalla: b.pantalla }) });
  }
  return NextResponse.json({ message: 'Acción desconocida' }, { status: 400 });
}
