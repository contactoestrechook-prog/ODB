import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

// Mercadería por llegar y WhatsApp de proveedores (23/10/2026): el proveedor
// confirma la fecha de entrega por WhatsApp y acá se ve qué llega y cuándo.
const API = process.env.API_URL ?? 'http://localhost:3001';

async function reenviar(ruta: string, init: RequestInit = {}) {
  const token = (await cookies()).get('odb_token')?.value;
  const res = await fetch(`${API}${ruta}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    cache: 'no-store',
  });
  if (!res.ok) console.warn('[api/por-llegar]', init.method ?? 'GET', ruta, '→', res.status);
  return NextResponse.json(await res.json().catch(() => ({})), { status: res.status });
}

// GET ?recurso=ordenes&sucursalId=… | ?recurso=proveedores
export async function GET(req: Request) {
  const url = new URL(req.url);
  const recurso = url.searchParams.get('recurso') ?? 'ordenes';
  if (recurso === 'proveedores') return reenviar('/pedidos-proveedor/proveedores-sin-whatsapp');
  const suc = url.searchParams.get('sucursalId');
  return reenviar(`/pedidos-proveedor/por-llegar${suc ? `?sucursalId=${encodeURIComponent(suc)}` : ''}`);
}

// POST { accion: 'entrega', id, fecha, horario } | { accion: 'whatsapp', id, telefono }
export async function POST(req: Request) {
  const { accion, id, ...d } = await req.json().catch(() => ({}));
  if (!id || typeof id !== 'string') return NextResponse.json({ message: 'Falta cuál' }, { status: 400 });
  if (accion === 'entrega') {
    return reenviar(`/pedidos-proveedor/ordenes/${encodeURIComponent(id)}/entrega`, { method: 'POST', body: JSON.stringify({ fecha: d.fecha, horario: d.horario ?? null }) });
  }
  if (accion === 'whatsapp') {
    return reenviar(`/pedidos-proveedor/proveedores/${encodeURIComponent(id)}/whatsapp`, { method: 'POST', body: JSON.stringify({ telefono: d.telefono }) });
  }
  return NextResponse.json({ message: 'Acción inválida' }, { status: 400 });
}
