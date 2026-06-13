import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API = process.env.API_URL ?? 'http://localhost:3001';

const GET_RECURSOS: Record<string, string> = {
  resumen: '/caja/resumen', cajas: '/caja/cajas', sesiones: '/caja/sesiones', arca: '/arca/pendientes',
  'por-cajero': '/caja/por-cajero', empleados: '/usuarios',
};
export async function GET(req: Request) {
  const token = (await cookies()).get('odb_token')?.value;
  const recurso = new URL(req.url).searchParams.get('recurso') ?? 'cajas';
  const ruta = GET_RECURSOS[recurso];
  if (!ruta) return NextResponse.json({ message: 'Recurso inválido' }, { status: 400 });
  const res = await fetch(`${API}${ruta}`, { headers: token ? { Authorization: `Bearer ${token}` } : {}, cache: 'no-store' });
  return NextResponse.json(await res.json(), { status: res.status });
}

// POST { accion: 'abrir'|'cerrar'|'arca', ...datos }
export async function POST(req: Request) {
  const token = (await cookies()).get('odb_token')?.value;
  const { accion, ...d } = await req.json().catch(() => ({}));
  const ruta = accion === 'abrir' ? '/caja/abrir' : accion === 'cerrar' ? '/caja/cerrar' : accion === 'arca' ? '/arca/emitir' : null;
  if (!ruta) return NextResponse.json({ message: 'Acción inválida' }, { status: 400 });
  const res = await fetch(`${API}${ruta}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(d),
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
