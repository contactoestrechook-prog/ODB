import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API = process.env.API_URL ?? 'http://localhost:3001';

// El agente de abastecimiento consulta y piensa en varias vueltas: puede pasar
// el minuto. Sin esto Next corta la respuesta y se ve un 504 pelado.
export const maxDuration = 300;

async function auth(): Promise<Record<string, string>> {
  const token = (await cookies()).get('odb_token')?.value;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function reenviar(res: Response): Promise<NextResponse> {
  const texto = await res.text();
  try {
    return NextResponse.json(texto ? JSON.parse(texto) : {}, { status: res.status });
  } catch {
    return NextResponse.json(
      { message: res.status >= 500 ? 'El agente tardó demasiado o el servidor no respondió. Probá con una consulta más chica (un proveedor o un rubro).' : `La API respondió ${res.status}.` },
      { status: res.status },
    );
  }
}

function caido(e: unknown): NextResponse {
  const porTiempo = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
  return NextResponse.json(
    { message: porTiempo ? 'El agente tardó más de lo permitido. Pedile una tanda más chica.' : 'No pude conectarme con el servidor. Probá de nuevo.' },
    { status: 504 },
  );
}

// ?que=resumen (default) | lista (&sucursal&alerta&q&limite) | propuestas (&sucursal)
export async function GET(req: Request) {
  const url = new URL(req.url);
  const que = url.searchParams.get('que') ?? 'resumen';
  const params = new URLSearchParams();
  for (const k of ['sucursal', 'alerta', 'q', 'limite']) {
    const v = url.searchParams.get(k);
    if (v) params.set(k, v);
  }
  try {
    const ruta = que === 'lista' || que === 'propuestas' ? que : 'resumen';
    const res = await fetch(`${API}/abastecimiento/${ruta}?${params}`, { headers: await auth(), cache: 'no-store' });
    return await reenviar(res);
  } catch (e) {
    return caido(e);
  }
}

// La charla con el agente, o (?que=orden) la nota tildada que se convierte en orden
export async function POST(req: Request) {
  const cuerpo = await req.json().catch(() => ({}) as any);
  if (new URL(req.url).searchParams.get('que') === 'orden') {
    try {
      const res = await fetch(`${API}/abastecimiento/orden`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await auth()) },
        body: JSON.stringify({ proveedorId: cuerpo?.proveedorId, sucursalId: cuerpo?.sucursalId, items: cuerpo?.items }),
        signal: AbortSignal.timeout(60_000),
      });
      return await reenviar(res);
    } catch (e) {
      return caido(e);
    }
  }
  const { mensajes } = cuerpo;
  try {
    const res = await fetch(`${API}/abastecimiento/charla`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await auth()) },
      body: JSON.stringify({ mensajes }),
      signal: AbortSignal.timeout(280_000),
    });
    return await reenviar(res);
  } catch (e) {
    return caido(e);
  }
}
