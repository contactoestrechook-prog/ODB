import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API = process.env.API_URL ?? 'http://localhost:3001';

async function reenviar(ruta: string, init: RequestInit = {}) {
  const token = (await cookies()).get('odb_token')?.value;
  const res = await fetch(`${API}${ruta}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    cache: 'no-store',
  });
  return NextResponse.json(await res.json().catch(() => ({ message: 'La API no respondió bien' })), { status: res.status });
}
const id = (v: unknown) => encodeURIComponent(String(v ?? ''));

// Op salón (5/11/2026). GET ?recurso=stock&q=… | lugares[&sucursalId] | sinlugar&sucursalId[&categoriaId] | codigo&codigo=… | ingresos&estado=… |
// preparadores | pedidos[&todos=1] | tiempos&dias=7 | parecidos&pedidoId&productoId[&faltan][&fiambreria=1]
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  switch (q.get('recurso')) {
    case 'stock': return reenviar(`/salon/stock?q=${id(q.get('q'))}`);
    // cuánto tiene lugar y qué falta (17/11/2026)
    case 'lugares': return reenviar(`/salon/lugares${q.get('sucursalId') ? `?sucursalId=${id(q.get('sucursalId'))}` : ''}`);
    case 'sinlugar': return reenviar(`/salon/sin-lugar?sucursalId=${id(q.get('sucursalId'))}${q.get('categoriaId') ? `&categoriaId=${id(q.get('categoriaId'))}` : ''}`);
    case 'codigo': return reenviar(`/salon/codigo/${id(q.get('codigo'))}`);
    case 'ingresos': return reenviar(`/salon/ingresos?estado=${id(q.get('estado') ?? 'espera_factura')}`);
    case 'preparadores': return reenviar(`/salon/preparadores${q.get('pedidoId') ? `?pedidoId=${id(q.get('pedidoId'))}` : ''}`);
    case 'tiempos': return reenviar(`/salon/tiempos?dias=${id(q.get('dias') ?? '7')}`);
    case 'pedidos': return reenviar(`/salon/pedidos${q.get('todos') === '1' ? '?todos=1' : ''}`);
    // fiambrería (19/11/2026): los pedidos con algo para preparar
    case 'fiambreria': return reenviar('/salon/fiambreria');
    // «Tengo parecido» (20/11/2026): lo que se parece al que falta, con stock y precio
    case 'parecidos': return reenviar(`/salon/${q.get('fiambreria') === '1' ? 'fiambreria' : 'pedidos'}/${id(q.get('pedidoId'))}/parecidos?productoId=${id(q.get('productoId'))}${q.get('faltan') ? `&faltan=${id(q.get('faltan'))}` : ''}`);
    default: return NextResponse.json({ message: 'Recurso desconocido' }, { status: 400 });
  }
}

// POST { accion, … }
export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  const cuerpo = (x: unknown) => ({ method: 'POST', body: JSON.stringify(x ?? {}) });
  switch (b?.accion) {
    case 'ubicacion': return reenviar('/salon/ubicacion', { method: 'PATCH', body: JSON.stringify({ productoId: b.productoId, sucursalId: b.sucursalId, ubicacion: b.ubicacion }) });
    case 'lugarcategoria': return reenviar('/salon/ubicacion/categoria', { method: 'PATCH', body: JSON.stringify({ sucursalId: b.sucursalId, categoriaId: b.categoriaId, ubicacion: b.ubicacion }) });
    case 'ingreso': return reenviar('/salon/ingresos', cuerpo({ proveedorId: b.proveedorId, sucursalId: b.sucursalId, numeroRemito: b.numeroRemito, notas: b.notas, items: b.items }));
    case 'confirmar': return reenviar(`/salon/ingresos/${id(b.ingresoId)}/confirmar`, cuerpo({ numeroFactura: b.numeroFactura, items: b.items }));
    case 'rechazar': return reenviar(`/salon/ingresos/${id(b.ingresoId)}/rechazar`, cuerpo({ motivo: b.motivo }));
    case 'asignar': return reenviar(`/salon/pedidos/${id(b.pedidoId)}/asignar`, cuerpo({ usuarioId: b.usuarioId }));
    case 'carro': return reenviar(`/salon/pedidos/${id(b.pedidoId)}/carro`, cuerpo({ codigo: b.codigo, productoId: b.productoId, cantidad: b.cantidad }));
    case 'sacar': return reenviar(`/salon/pedidos/${id(b.pedidoId)}/carro/${id(b.cargaId)}`, { method: 'DELETE' });
    case 'terminar': return reenviar(`/salon/pedidos/${id(b.pedidoId)}/terminar`, cuerpo({}));
    // falta stock al armar (19/11/2026)
    // + variedades / avisar (20/11/2026: «no hay ese sabor, y cuáles sí»)
    case 'falta': return reenviar(`/salon/pedidos/${id(b.pedidoId)}/falta`, cuerpo({ productoId: b.productoId, hay: b.hay, reemplazoId: b.reemplazoId, cantidad: b.cantidad, variedades: Array.isArray(b.variedades) ? b.variedades : undefined, pedida: typeof b.pedida === 'string' ? b.pedida : undefined, avisar: b.avisar === true }));
    // «Tengo parecido» y la consulta al cliente (20/11/2026)
    case 'consultar': return reenviar(`/salon/pedidos/${id(b.pedidoId)}/consultar`, cuerpo({}));
    case 'decidir-cambio': return reenviar(`/salon/pedidos/${id(b.pedidoId)}/cambios/${id(b.cambioId)}/decidir`, cuerpo({ acepta: b.acepta === true, elegida: typeof b.elegida === 'string' ? b.elegida : undefined }));
    case 'anular-cambio': return reenviar(`/salon/pedidos/${id(b.pedidoId)}/cambios/${id(b.cambioId)}`, { method: 'DELETE' });
    case 'fiambreria-preparo': return reenviar(`/salon/fiambreria/${id(b.pedidoId)}/preparo`, cuerpo({}));
    // «No hay» desde la ventana de fiambrería (19/11/2026)
    case 'fiambreria-falta': return reenviar(`/salon/fiambreria/${id(b.pedidoId)}/falta`, cuerpo({ productoId: b.productoId, hay: b.hay, reemplazoId: b.reemplazoId, cantidad: b.cantidad }));
    default: return NextResponse.json({ message: 'Acción desconocida' }, { status: 400 });
  }
}
