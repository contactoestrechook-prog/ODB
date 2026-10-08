import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API = process.env.API_URL ?? 'http://localhost:3001';

// Foto de la factura/remito → extracción con IA (proveedor, renglones, impuestos).
// La lectura corre en SEGUNDO PLANO: el POST con archivo devuelve un id al
// instante; el GET pregunta por una lectura (?id=) o trae la bandeja
// (?bandeja=1); el POST con JSON ejecuta acciones sobre una lectura
// (abrir / descartar / releer con aclaraciones).
export async function POST(req: Request) {
  const token = (await cookies()).get('odb_token')?.value;
  const auth: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
  const ct = req.headers.get('content-type') ?? '';
  if (ct.includes('application/json')) {
    const b = await req.json().catch(() => ({}) as any);
    // la factura editable (8/10/2026): chat con IA, constancia de cambios y
    // reglas del proveedor; llevan el cuerpo entero
    const conCuerpo = ['chat', 'revision', 'regla', 'historial'].includes(b?.accion);
    const id = encodeURIComponent(String(b?.id ?? 'sin-lectura'));
    const ruta =
      b?.accion === 'releer' ? `/compras/entrada-foto/${id}/releer`
      : b?.accion === 'abrir' ? `/compras/entrada-foto/${id}/abrir`
      : b?.accion === 'descartar' ? `/compras/entrada-foto/${id}/descartar`
      : b?.accion === 'chat' ? `/compras/entrada-foto/${id}/chat`
      : b?.accion === 'revision' ? `/compras/entrada-foto/${id}/revision`
      // lo que nos vende cada proveedor: todos los renglones de la factura registrada (8/10/2026)
      : b?.accion === 'historial' ? `/compras/entrada-foto/${id}/historial`
      : b?.accion === 'regla' ? `/compras/proveedores/${encodeURIComponent(String(b?.proveedorId ?? ''))}/reglas-lectura`
      : b?.accion === 'quitarRegla' ? `/compras/reglas-lectura/${id}/desactivar`
      : null;
    if (!ruta) return NextResponse.json({ message: 'Acción inválida' }, { status: 400 });
    const res = await fetch(`${API}${ruta}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth },
      body: JSON.stringify(conCuerpo ? b : { aclaraciones: b.aclaraciones ?? '' }),
    });
    return NextResponse.json(await res.json().catch(() => ({})), { status: res.status });
  }
  const form = await req.formData();
  const res = await fetch(`${API}/compras/entrada-foto`, { method: 'POST', headers: auth, body: form });
  return NextResponse.json(await res.json().catch(() => ({})), { status: res.status });
}

export async function GET(req: Request) {
  const token = (await cookies()).get('odb_token')?.value;
  const auth: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
  const url = new URL(req.url);
  const ruta = url.searchParams.get('bandeja')
    ? '/compras/lecturas'
    : url.searchParams.get('reglas')
    ? `/compras/proveedores/${encodeURIComponent(url.searchParams.get('reglas') ?? '')}/reglas-lectura`
    : url.searchParams.get('original')
    ? `/compras/entrada-foto/${encodeURIComponent(url.searchParams.get('original') ?? '')}/original`
    : `/compras/entrada-foto/${encodeURIComponent(url.searchParams.get('id') ?? '')}`;
  const res = await fetch(`${API}${ruta}`, { headers: auth, cache: 'no-store' });
  return NextResponse.json(await res.json().catch(() => ({})), { status: res.status });
}
