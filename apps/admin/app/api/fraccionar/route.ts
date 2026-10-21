import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API = process.env.API_URL ?? 'http://localhost:3001';

async function cabeceras(json = false): Promise<Record<string, string>> {
  const token = (await cookies()).get('odb_token')?.value;
  return {
    ...(json ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function reenviar(res: Response) {
  const datos = await res.json().catch(() => ({ message: 'La API no respondió bien' }));
  return NextResponse.json(datos, { status: res.status });
}

// Fraccionar (21/10/2026).
// GET                              → grupos (pozo + presentaciones) con stock, precio y "alcanza para"
// GET ?recurso=historial&sucursalId → lo último que se armó, se abrió o se cargó al pozo
export async function GET(req: Request) {
  const url = new URL(req.url);
  if (url.searchParams.get('recurso') === 'historial') {
    const qs = new URLSearchParams({ sucursalId: url.searchParams.get('sucursalId') ?? '' });
    const limite = url.searchParams.get('limite');
    if (limite) qs.set('limite', limite);
    return reenviar(await fetch(`${API}/stock/fraccionables/historial?${qs}`, { headers: await cabeceras(), cache: 'no-store' }));
  }
  return reenviar(await fetch(`${API}/stock/fraccionables`, { headers: await cabeceras(), cache: 'no-store' }));
}

// POST { accion, ...datos }
//   armar (o sin accion) → arma (cantidad > 0) o abre y pasa al pozo (cantidad < 0)
//   cargar-pozo          → ingreso manual al pozo (mismas reglas y PIN que un ajuste)
//   vincular             → suma una presentación (existente o nueva) a un pozo
//   editar               → nombre, precio o lo que lleva una presentación
//   quitar               → saca la presentación del grupo (no borra el producto)
export async function POST(req: Request) {
  const { accion, ...datos } = await req.json().catch(() => ({}));
  const id = encodeURIComponent(String(datos.id ?? datos.pozoId ?? ''));
  const destino: { ruta: string; metodo: 'POST' | 'PATCH' } | null =
    !accion || accion === 'armar' ? { ruta: '/stock/fraccionar', metodo: 'POST' }
    : accion === 'cargar-pozo' ? { ruta: `/stock/fraccionables/${id}/cargar`, metodo: 'POST' }
    : accion === 'vincular' ? { ruta: '/stock/fraccionables/presentaciones', metodo: 'POST' }
    : accion === 'editar' ? { ruta: `/stock/fraccionables/presentaciones/${id}`, metodo: 'PATCH' }
    : accion === 'quitar' ? { ruta: `/stock/fraccionables/presentaciones/${id}/quitar`, metodo: 'POST' }
    : null;
  if (!destino) return NextResponse.json({ message: 'Acción inválida' }, { status: 400 });
  return reenviar(
    await fetch(`${API}${destino.ruta}`, {
      method: destino.metodo,
      headers: await cabeceras(true),
      body: JSON.stringify(datos),
    }),
  );
}
