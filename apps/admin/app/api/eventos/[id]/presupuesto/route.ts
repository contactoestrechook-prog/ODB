import { cookies } from 'next/headers';

const API = process.env.API_URL ?? 'http://localhost:3001';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = (await cookies()).get('odb_token')?.value;
  const res = await fetch(`${API}/eventos/${id}/presupuesto`, {
    headers: t ? { Authorization: `Bearer ${t}` } : {},
    cache: 'no-store',
  });
  if (!res.ok) {
    return new Response(await res.text(), { status: res.status });
  }
  const buf = await res.arrayBuffer();
  return new Response(buf, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="presupuesto-${id.slice(0, 8)}.pdf"`,
    },
  });
}
