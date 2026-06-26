// Engancha los EAN de fábrica (basetemporal.tablatemporal) a los productos por codigo_legacy.
// Solo EAN ÚNICOS (que identifican 1 solo producto). Idempotente (upsert por codigo de barra).
import MDBReader from 'mdb-reader';
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const env = Object.fromEntries(readFileSync('../apps/api/.env', 'utf8').split('\n')
  .map((l) => l.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].replace(/^["']|["']$/g, '')]));
const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const chunk = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };

const rows = new (MDBReader.default ?? MDBReader)(readFileSync('/Volumes/NO NAME/basetemporal.mdb')).getTable('tablatemporal').getData({ rowLimit: 1e6 });

const codigoToEan = new Map();
for (const x of rows) {
  const cod = String(x.codigo ?? '').trim();
  const ean = String(x.codigobarra ?? '').trim();
  if (cod && /^\d{8,14}$/.test(ean) && !codigoToEan.has(cod)) codigoToEan.set(cod, ean);
}
// EAN → códigos (para detectar ambigüedad)
const eanToCods = new Map();
for (const [cod, ean] of codigoToEan) { (eanToCods.get(ean) ?? eanToCods.set(ean, new Set()).get(ean)).add(cod); }
const ambiguos = [...eanToCods.values()].filter((s) => s.size > 1).length;

// solo EAN únicos
const candidatos = [...codigoToEan.entries()].filter(([, ean]) => eanToCods.get(ean).size === 1);
console.log(`tablatemporal: ${codigoToEan.size} códigos con EAN · ${ambiguos} EAN ambiguos (salteados) · ${candidatos.length} candidatos únicos`);

// codigo_legacy → producto_id (solo activos)
const idPorCod = new Map();
for (const g of chunk(candidatos.map(([c]) => c), 600)) {
  const { data, error } = await db.from('productos').select('id, codigo_legacy, activo').in('codigo_legacy', g);
  if (error) throw new Error(error.message);
  for (const p of data ?? []) if (p.activo) idPorCod.set(p.codigo_legacy, p.id);
}

const filas = candidatos.filter(([c]) => idPorCod.has(c)).map(([c, ean]) => ({ codigo: ean, producto_id: idPorCod.get(c) }));
console.log(`a enganchar (producto activo + EAN único): ${filas.length}`);

let ok = 0;
for (const g of chunk(filas, 500)) {
  const { error } = await db.from('codigos_barras').upsert(g, { onConflict: 'codigo' });
  if (error) throw new Error('upsert: ' + error.message);
  ok += g.length; process.stdout.write(`\r  enganchados: ${ok}/${filas.length}`);
}
console.log('\nLISTO.');
const { count } = await db.from('codigos_barras').select('*', { count: 'exact', head: true });
console.log('total códigos de barra en la base ahora:', count);
