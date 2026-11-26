import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API = process.env.API_URL ?? 'http://localhost:3001';
async function tok(): Promise<Record<string, string>> { const t = (await cookies()).get('odb_token')?.value; return t ? { Authorization: `Bearer ${t}` } : {}; }

// Quiénes compran a esta cuenta desde su WhatsApp (26/11/2026): el bot los reconoce.
// POST { clienteId } suma a la persona; DELETE ?clienteId= la saca.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const b = await req.json().catch(() => ({}));
  const res = await fetch(`${API}/cta-cte/cliente/${encodeURIComponent(id)}/compran`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(await tok()) }, body: JSON.stringify({ clienteId: String(b?.clienteId ?? '') }),
  });
  return NextResponse.json(await res.json().catch(() => ({})), { status: res.status });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const persona = new URL(req.url).searchParams.get('clienteId') ?? '';
  const res = await fetch(`${API}/cta-cte/cliente/${encodeURIComponent(id)}/compran/${encodeURIComponent(persona)}`, { method: 'DELETE', headers: await tok() });
  return NextResponse.json(await res.json().catch(() => ({})), { status: res.status });
}
