import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Qué versión del panel está publicada. Se calcula UNA vez cuando arranca el
// proceso: en Railway cada deploy levanta un proceso nuevo, así que este valor
// cambia exactamente cuando cambia la versión. El navegador lo compara con el
// que tenía al abrir la pestaña y ofrece actualizar.
//
// Se prefiere el id del deploy (si el hosting lo inyecta) porque no cambia
// cuando el proceso se reinicia solo, y ahí no hay nada nuevo que bajar.
const VERSION =
  process.env.RAILWAY_DEPLOYMENT_ID ??
  process.env.RAILWAY_GIT_COMMIT_SHA ??
  String(Date.now());

export async function GET() {
  return NextResponse.json({ version: VERSION }, { headers: { 'cache-control': 'no-store' } });
}
