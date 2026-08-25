import { cookies } from 'next/headers';

const API = process.env.API_URL ?? 'http://localhost:3001';

// Papeles con folio de la casa (orden de compra, orden de pago, recibo, acta
// de recepción).
// Salen en PDF desde la API y pasan derecho al navegador: se abren en una
// pestaña, se imprimen o se mandan por mail sin descargar nada raro.
const RUTAS: Record<string, (id: string) => string> = {
  oc: (id) => `/compras/ordenes/${encodeURIComponent(id)}/documento`,
  recibo: (id) => `/cobranzas/${encodeURIComponent(id)}/recibo`,
  remito: (id) => `/compras/recepciones/${encodeURIComponent(id)}/documento`,
  op: (id) => `/compras/ordenes-pago/${encodeURIComponent(id)}/documento`,
};

export async function GET(req: Request) {
  const url = new URL(req.url);
  const tipo = url.searchParams.get('tipo') ?? '';
  const id = url.searchParams.get('id') ?? '';
  const ruta = RUTAS[tipo];
  if (!ruta || !id) return new Response('Documento inválido', { status: 400 });

  const token = (await cookies()).get('odb_token')?.value;
  const res = await fetch(`${API}${ruta(id)}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    cache: 'no-store',
  });
  if (!res.ok) {
    const texto = await res.text();
    let mensaje = texto;
    try { mensaje = JSON.parse(texto)?.message ?? texto; } catch { /* la API no siempre responde JSON */ }
    return new Response(mensaje || 'No se pudo emitir el documento', { status: res.status });
  }
  return new Response(await res.arrayBuffer(), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': res.headers.get('content-disposition') ?? `inline; filename="${tipo}.pdf"`,
    },
  });
}
