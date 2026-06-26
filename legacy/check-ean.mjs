// Cruza los EAN de basetemporal.tablatemporal con nuestro catálogo (productos.codigo_legacy).
import MDBReader from 'mdb-reader';
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const env = Object.fromEntries(readFileSync('../apps/api/.env', 'utf8').split('\n')
  .map((l) => l.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].replace(/^["']|["']$/g, '')]));
const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const chunk = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };

const r = new (MDBReader.default ?? MDBReader)(readFileSync('/Volumes/NO NAME/basetemporal.mdb'));
const rows = r.getTable('tablatemporal').getData({ rowLimit: 1e6 });

// dedupe por codigo, EAN válido (8-14 díg)
const porCodigo = new Map();
for (const x of rows) {
  const cod = String(x.codigo ?? '').trim();
  const ean = String(x.codigobarra ?? '').trim();
  if (!cod || !/^\d{8,14}$/.test(ean)) continue;
  if (!porCodigo.has(cod)) porCodigo.set(cod, ean);
}
console.log(`tablatemporal: ${rows.length} filas · ${porCodigo.size} códigos con EAN válido`);

// cuántos codigos existen como codigo_legacy en productos
const codigos = [...porCodigo.keys()];
let enCatalogo = 0, activos = 0;
for (const g of chunk(codigos, 600)) {
  const { data, error } = await db.from('productos').select('codigo_legacy, activo').in('codigo_legacy', g);
  if (error) throw new Error(error.message);
  enCatalogo += (data ?? []).length;
  activos += (data ?? []).filter((p) => p.activo).length;
}
console.log(`de esos códigos, EN nuestro catálogo (codigo_legacy): ${enCatalogo} (${activos} activos)`);
console.log(`→ productos que recibirían su EAN de fábrica: ${activos}`);
// ejemplos
console.log('\nEjemplos:');
for (const [cod, ean] of [...porCodigo.entries()].slice(0, 5)) {
  const { data } = await db.from('productos').select('nombre').eq('codigo_legacy', cod).maybeSingle();
  console.log(`  codigo ${cod} · EAN ${ean} · ${data?.nombre ?? '(no está en catálogo)'}`);
}
