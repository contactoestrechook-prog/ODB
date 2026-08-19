import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API = process.env.API_URL ?? 'http://localhost:3001';

// El analista de compras (claude-opus-4-8 con thinking + varias vueltas de
// herramientas sobre la planilla) puede tardar más de un minuto. Sin esto, el
// runtime de Next corta la respuesta y el usuario ve un 500/504 pelado.
export const maxDuration = 300;

async function auth(): Promise<Record<string, string>> {
  const token = (await cookies()).get('odb_token')?.value;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// Reenvía lo que devuelva la API tal cual, PERO nunca revienta con un 500 pelado:
// si la API contesta algo que no es JSON (502/504 HTML del edge de Railway, un
// timeout, la conexión cortada), devuelve un mensaje claro que la pantalla muestra.
async function reenviar(res: Response): Promise<NextResponse> {
  const texto = await res.text();
  try {
    return NextResponse.json(texto ? JSON.parse(texto) : {}, { status: res.status });
  } catch {
    const message =
      res.status >= 500
        ? 'El analista tardó demasiado o el servidor no respondió. Probá de nuevo, o pedile menos renglones de una.'
        : `La API respondió ${res.status}.`;
    return NextResponse.json({ message, status: res.status }, { status: res.status });
  }
}

function caido(e: unknown): NextResponse {
  // AbortSignal.timeout() lanza un TimeoutError; un abort manual, un AbortError.
  const porTiempo = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
  return NextResponse.json(
    {
      message: porTiempo
        ? 'El analista tardó más de lo permitido. Es demasiada planilla de una: pedile menos renglones a la vez (por ejemplo los primeros 30).'
        : 'No pude conectarme con el servidor. Probá de nuevo.',
    },
    { status: 504 },
  );
}

// Bandeja de propuestas esperando la aprobación del dueño
export async function GET() {
  try {
    const res = await fetch(`${API}/compras/propuestas`, {
      headers: await auth(),
      cache: 'no-store',
    });
    return await reenviar(res);
  } catch (e) {
    return caido(e);
  }
}

// accion: charla (default) | aprobar | rechazar
export async function POST(req: Request) {
  const { accion, ...d } = await req.json().catch(() => ({}) as any);
  const ruta =
    accion === 'aprobar'
      ? `/compras/propuestas/${d.id}/aprobar`
      : accion === 'rechazar'
        ? `/compras/propuestas/${d.id}/rechazar`
        : '/compras/mesa/charla';

  // La charla puede ser larga: le damos hasta ~4,5 min, por debajo del corte del edge.
  const timeout = ruta.endsWith('/charla') ? 270_000 : 30_000;
  try {
    const res = await fetch(`${API}${ruta}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await auth()) },
      body: JSON.stringify(d),
      signal: AbortSignal.timeout(timeout),
    });
    return await reenviar(res);
  } catch (e) {
    return caido(e);
  }
}
