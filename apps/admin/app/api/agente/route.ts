import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API = process.env.API_URL ?? 'http://localhost:3001';
async function token() { return (await cookies()).get('odb_token')?.value; }

export async function GET(req: Request) {
  const t = await token();
  const sp = new URL(req.url).searchParams;
  const auditoria = sp.get('auditoria');
  const recurso = sp.get('recurso');
  const ruta = auditoria
    ? `/agente/tareas/${auditoria}/auditoria`
    : recurso === 'resumen'
      ? '/agente/resumen'
      : `/agente/tareas${sp.get('estado') ? `?estado=${sp.get('estado')}` : ''}`;
  const res = await fetch(`${API}${ruta}`, { headers: t ? { Authorization: `Bearer ${t}` } : {}, cache: 'no-store' });
  return NextResponse.json(await res.json(), { status: res.status });
}

// POST { accion: 'encolar'|'procesar'|'barrido'|'ejecutar'|'resolver', ... }
export async function POST(req: Request) {
  const t = await token();
  const { accion, id, ...d } = await req.json().catch(() => ({}));
  const ruta =
    accion === 'encolar' ? '/agente/encolar'
    : accion === 'procesar' ? '/agente/procesar'
    : accion === 'barrido' ? '/agente/barrido'
    : accion === 'enriquecer' ? '/agente/enriquecer'
    : accion === 'fotos' ? '/agente/fotos'
    : accion === 'ejecutar' ? `/agente/tareas/${id}/ejecutar`
    : accion === 'resolver' ? `/agente/tareas/${id}/resolver`
    : null;
  if (!ruta) return NextResponse.json({ message: 'Acción inválida' }, { status: 400 });
  const res = await fetch(`${API}${ruta}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) },
    body: JSON.stringify(d),
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
