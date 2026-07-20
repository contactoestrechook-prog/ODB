#!/usr/bin/env node
// Verifica que la clave pública (anon) de Supabase NO pueda leer datos ni
// ejecutar funciones sensibles. Hallazgo P0-01 de la auditoría pre-piloto.
// Uso: node scripts/verificar-anon.mjs   (lee SUPABASE_URL y SUPABASE_KEY de apps/api/.env o del entorno)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const raiz = dirname(dirname(fileURLToPath(import.meta.url)));
function envDe(archivo) {
  try {
    return Object.fromEntries(
      readFileSync(archivo, 'utf8')
        .split('\n')
        .filter((l) => l.includes('=') && !l.trimStart().startsWith('#'))
        .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
    );
  } catch { return {}; }
}
const env = { ...envDe(join(raiz, 'apps/api/.env')), ...process.env };
const URL = env.SUPABASE_URL;
const ANON = env.SUPABASE_KEY;
if (!URL || !ANON) { console.error('Faltan SUPABASE_URL / SUPABASE_KEY'); process.exit(2); }

const H = { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' };
const casos = [
  ['GET', `${URL}/rest/v1/productos?select=sku&limit=1`, null, 'leer productos'],
  ['GET', `${URL}/rest/v1/autorizaciones_caja?select=id&limit=1`, null, 'leer autorizaciones_caja'],
  ['POST', `${URL}/rest/v1/rpc/verificar_pin_supervisor`, { p_pin: '0000' }, 'verificar_pin_supervisor'],
  ['POST', `${URL}/rest/v1/rpc/registrar_venta`, { p_sucursal: '00000000-0000-0000-0000-000000000000', p_items: [], p_pagos: [] }, 'registrar_venta'],
  ['POST', `${URL}/rest/v1/rpc/anular_venta`, { p_venta: '00000000-0000-0000-0000-000000000000' }, 'anular_venta'],
  ['POST', `${URL}/rest/v1/rpc/finalizar_conteo`, { p_conteo: '00000000-0000-0000-0000-000000000000' }, 'finalizar_conteo'],
];

let fallas = 0;
for (const [metodo, url, body, nombre] of casos) {
  const res = await fetch(url, { method: metodo, headers: H, body: body ? JSON.stringify(body) : undefined });
  const bloqueado = res.status === 401 || res.status === 403;
  console.log(`${bloqueado ? '✓' : '✗'} anon ${nombre}: HTTP ${res.status}${bloqueado ? ' (bloqueado)' : ' — DEBERÍA ESTAR BLOQUEADO'}`);
  if (!bloqueado) fallas++;
}
if (fallas) { console.error(`\n${fallas} caso(s) NO bloqueados: la clave anon puede operar. Corré db/migracion-cerrar-anon.sql`); process.exit(1); }
console.log('\nTODO BLOQUEADO: la clave anon no puede leer ni ejecutar nada.');
