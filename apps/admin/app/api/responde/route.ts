import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API = process.env.API_URL ?? 'http://localhost:3001';

// Bandeja y métricas de RESPONDE (el empleado virtual): proxy con la sesión staff
export async function GET(req: Request) {
  const token = (await cookies()).get('odb_token')?.value;
  const url = new URL(req.url);
  const recurso = url.searchParams.get('recurso') ?? '';
  let ruta: string | null = null;
  if (recurso === 'conversaciones') ruta = '/bot/conversaciones';
  else if (recurso === 'detalle') {
    ruta = `/bot/conversaciones/detalle?linea=${encodeURIComponent(url.searchParams.get('linea') ?? '')}&telefono=${encodeURIComponent(url.searchParams.get('telefono') ?? '')}`;
  } else if (recurso === 'resumen') ruta = '/bot/responde/resumen';
  else if (recurso === 'linea') ruta = `/bot/linea/estado?linea=${encodeURIComponent(url.searchParams.get('linea') ?? 'pedidos')}`;
  else if (recurso === 'ficha') ruta = `/bot/contactos/ficha?telefono=${encodeURIComponent(url.searchParams.get('telefono') ?? '')}`;
  else if (recurso === 'programados') ruta = `/bot/programados${url.searchParams.get('telefono') ? `?telefono=${encodeURIComponent(url.searchParams.get('telefono')!)}` : ''}`;
  else if (recurso === 'difusiones') ruta = '/bot/difusiones';
  else if (recurso === 'base') ruta = '/bot/difusiones/base';
  else if (recurso === 'listas') ruta = '/bot/listas';
  else if (recurso === 'listaTelefonos') ruta = `/bot/listas/${encodeURIComponent(url.searchParams.get('id') ?? '')}/telefonos`;
  if (!ruta) return NextResponse.json({ message: 'Recurso inválido' }, { status: 400 });
  const res = await fetch(`${API}${ruta}`, { headers: token ? { Authorization: `Bearer ${token}` } : {}, cache: 'no-store' });
  return NextResponse.json(await res.json(), { status: res.status });
}

// Responder desde la bandeja / devolverle la conversación al bot
export async function POST(req: Request) {
  const token = (await cookies()).get('odb_token')?.value;
  const { accion, ...d } = await req.json().catch(() => ({}) as any);
  const ruta =
    accion === 'devolver' ? '/bot/conversaciones/devolver'
    : accion === 'pausar' ? '/bot/conversaciones/pausar'
    : accion === 'leida' ? '/bot/conversaciones/leida'
    : accion === 'botLinea' ? '/bot/linea/bot'
    : accion === 'equipo' ? '/bot/conversaciones/equipo'
    : accion === 'nota' ? '/bot/contactos/nota'
    : accion === 'programar' ? '/bot/programados'
    : accion === 'cancelarProgramado' ? `/bot/programados/${d.id}/cancelar`
    : accion === 'difusion' ? '/bot/difusiones'
    : '/bot/conversaciones/responder';
  const res = await fetch(`${API}${ruta}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(d),
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
