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
  const usuarioId = subDe(token);
  const url = new URL(req.url);
  const recurso = url.searchParams.get('recurso') ?? '';
  let ruta: string | undefined;
  if (recurso === 'factura' && url.searchParams.get('id')) {
    // detalle de una factura de proveedor: ?recurso=factura&id=UUID
    ruta = `/compras/facturas/${encodeURIComponent(url.searchParams.get('id')!)}`;
  } else if (recurso === 'facturas') {
    // listado con filtros: se reenvían todos los query params tal cual
    const params = new URLSearchParams(url.searchParams);
    params.delete('recurso');
    ruta = `/compras/facturas?${params.toString()}`;
  } else if (recurso === 'facturas-resumen') {
    ruta = '/compras/facturas/resumen';
  } else if (recurso === 'facturas-cambios') {
    // solicitudes de cambio sobre facturas (pendientes / por factura)
    const params = new URLSearchParams(url.searchParams);
    params.delete('recurso');
    ruta = `/compras/facturas/cambios?${params.toString()}`;
  } else if (recurso === 'mis-facturas') {
    // "Mis facturas": el filtro por quien cargó sale del token, no del cliente
    const params = new URLSearchParams(url.searchParams);
    params.delete('recurso');
    if (usuarioId) params.set('cargadaPor', usuarioId);
    ruta = `/compras/facturas?${params.toString()}`;
  } else if (recurso === 'conciliacion') {
    ruta = '/compras/conciliacion';
  } else if (recurso === 'cruce') {
    ruta = `/compras/conciliacion/cruce?facturaId=${encodeURIComponent(url.searchParams.get('facturaId') ?? '')}&remitos=${encodeURIComponent(url.searchParams.get('remitos') ?? '')}`;
  } else if (recurso === 'codigo') {
    ruta = `/compras/recepcion/codigo/${encodeURIComponent(url.searchParams.get('codigo') ?? '')}`;
  } else {
    ruta = GET_RECURSOS[recurso];
  }
  // los 400 de esta ruta no se ven desde afuera (el navegador solo muestra
  // "api/compras 400"): se registran acá para poder rastrearlos en los logs
  if (!ruta) {
    console.warn('[api/compras] recurso inválido:', url.search, '· usuario', usuarioId ?? 'sin token');
    return NextResponse.json({ message: 'Recurso inválido' }, { status: 400 });
  }
  const res = await fetch(`${API}${ruta}`, { headers: token ? { Authorization: `Bearer ${token}` } : {}, cache: 'no-store' });
  if (!res.ok) console.warn('[api/compras]', ruta, '→', res.status, '· usuario', usuarioId ?? 'sin token');
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
    case 'entradaDirecta': ruta = '/compras/entrada-directa'; body = { ...d, usuarioId }; break;
    case 'crearProveedor': ruta = '/proveedores'; break;
    case 'editarProveedor': ruta = `/proveedores/${d.id}`; metodo = 'PATCH'; break;
    case 'factura': ruta = '/compras/facturas'; break;
    case 'recepcion': ruta = '/compras/recepcion'; body = { ...d, usuarioId }; break;
    case 'vincularCodigo': ruta = '/compras/recepcion/codigo'; break;
    case 'conciliar': ruta = '/compras/conciliacion/confirmar'; break;
    case 'editarFactura': ruta = `/compras/facturas/${d.id}`; metodo = 'PATCH'; break;
    case 'solicitarCambioFactura': ruta = `/compras/facturas/${d.id}/solicitar-cambio`; body = { cambios: d.cambios, motivo: d.motivo, tipo: d.tipo }; break;
    case 'aprobarCambioFactura': ruta = `/compras/facturas/cambios/${d.id}/aprobar`; body = { respuesta: d.respuesta }; break;
    case 'rechazarCambioFactura': ruta = `/compras/facturas/cambios/${d.id}/rechazar`; body = { respuesta: d.respuesta }; break;
    case 'anularFactura': ruta = `/compras/facturas/${d.id}/anular`; break;
    case 'pagoFactura': ruta = `/compras/facturas/${d.id}/pagos`; break;
    case 'crearOP': ruta = '/compras/ordenes-pago'; body = { ...d, usuarioId }; break;
    case 'aprobarOP': ruta = `/compras/ordenes-pago/${d.id}/aprobar`; body = { usuarioId }; break;
    case 'rechazarOP': ruta = `/compras/ordenes-pago/${d.id}/rechazar`; body = { motivo: d.motivo, usuarioId }; break;
    case 'pagarOP': ruta = `/compras/ordenes-pago/${d.id}/pagar`; body = { usuarioId, chequesPropios: d.chequesPropios, chequesTercerosIds: d.chequesTercerosIds }; break;
    default:
      console.warn('[api/compras] acción inválida:', accion, '· usuario', usuarioId ?? 'sin token');
      return NextResponse.json({ message: 'Acción inválida' }, { status: 400 });
  }

  const res = await fetch(`${API}${ruta}`, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  if (!res.ok) console.warn('[api/compras]', metodo, ruta, '→', res.status, '· usuario', usuarioId ?? 'sin token');
  return NextResponse.json(await res.json(), { status: res.status });
}
