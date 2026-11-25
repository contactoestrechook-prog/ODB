import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API = process.env.API_URL ?? 'http://localhost:3001';

// Presupuestos (25/11/2026): la lista, el buscador, uno, el PDF y las acciones. La API
// decide quién puede (todos los del local).
async function auth(): Promise<Record<string, string>> {
  const token = (await cookies()).get('odb_token')?.value;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

const id36 = (v: unknown) => (/^[0-9a-f-]{36}$/i.test(String(v ?? '')) ? String(v) : null);

async function reenviar(ruta: string, init: RequestInit = {}) {
  const res = await fetch(`${API}${ruta}`, { ...init, headers: { ...(await auth()), ...(init.body ? { 'Content-Type': 'application/json' } : {}) }, cache: 'no-store' });
  return NextResponse.json(await res.json().catch(() => ({})), { status: res.status });
}

// ?recurso=lista&filtro=abiertos | productos&q=&sucursalId= | sucursales | uno&id= | pdf&id=
export async function GET(req: Request) {
  const u = new URL(req.url).searchParams;
  const recurso = u.get('recurso') ?? 'lista';
  if (recurso === 'productos') {
    const p = new URLSearchParams({ q: (u.get('q') ?? '').slice(0, 80) });
    const suc = id36(u.get('sucursalId'));
    if (suc) p.set('sucursalId', suc);
    return reenviar(`/presupuestos/productos?${p}`);
  }
  if (recurso === 'sucursales') return reenviar('/presupuestos/sucursales');
  if (recurso === 'uno' || recurso === 'pdf') {
    const id = id36(u.get('id'));
    if (!id) return NextResponse.json({ message: 'Presupuesto inválido' }, { status: 400 });
    if (recurso === 'uno') return reenviar(`/presupuestos/${id}`);
    const res = await fetch(`${API}/presupuestos/${id}/pdf`, { headers: await auth(), cache: 'no-store' });
    if (!res.ok) return new Response(await res.text(), { status: res.status });
    return new Response(await res.arrayBuffer(), {
      status: 200,
      headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': res.headers.get('content-disposition') ?? 'inline; filename="presupuesto.pdf"' },
    });
  }
  const filtro = ['abiertos', 'aceptados', 'vencidos', 'todos'].includes(u.get('filtro') ?? '') ? u.get('filtro')! : 'abiertos';
  return reenviar(`/presupuestos?filtro=${filtro}`);
}

// { accion: 'guardar' (con o sin id) | 'enviar' | 'pedido' | 'anular', id?, ...datos }
export async function POST(req: Request) {
  const { accion, id, ...datos } = (await req.json().catch(() => ({}))) as { accion?: string; id?: string } & Record<string, unknown>;
  const pid = id36(id);
  if (accion === 'guardar') return reenviar(pid ? `/presupuestos/${pid}` : '/presupuestos', { method: 'POST', body: JSON.stringify(datos) });
  if (!pid) return NextResponse.json({ message: 'Presupuesto inválido' }, { status: 400 });
  if (accion === 'enviar') return reenviar(`/presupuestos/${pid}/enviar`, { method: 'POST' });
  if (accion === 'pedido') return reenviar(`/presupuestos/${pid}/pedido`, { method: 'POST', body: JSON.stringify(datos) });
  if (accion === 'anular') return reenviar(`/presupuestos/${pid}/anular`, { method: 'POST' });
  return NextResponse.json({ message: 'Acción desconocida' }, { status: 400 });
}
