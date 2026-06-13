import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API = process.env.API_URL ?? 'http://localhost:3001';

// Operaciones de stock: { accion: 'ajuste'|'merma'|'transferencia'|'recibir', ...datos }
export async function POST(req: Request) {
  const token = (await cookies()).get('odb_token')?.value;
  const { accion, ...datos } = await req.json().catch(() => ({}));
  const ruta =
    accion === 'ajuste' ? '/stock/ajustes'
    : accion === 'merma' ? '/stock/mermas'
    : accion === 'transferencia' ? '/stock/transferencias'
    : accion === 'recibir' ? `/stock/transferencias/${datos.transferenciaId}/recibir`
    : null;
  if (!ruta) return NextResponse.json({ message: 'Acción inválida' }, { status: 400 });

  const res = await fetch(`${API}${ruta}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(datos),
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
