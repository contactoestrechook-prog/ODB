import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const env = Object.fromEntries(readFileSync('../apps/api/.env', 'utf8').split('\n')
  .map((l) => l.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].replace(/^["']|["']$/g, '')]));
const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

const rows = JSON.parse(readFileSync('/tmp/arcor.json', 'utf8'));
const TH = 0.42;
const chunk = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };

let match = 0, nuevo = 0, conEan = 0;
const ejMatch = [], ejNuevo = [];

for (const grupo of chunk(rows, 25)) {
  const res = await Promise.all(grupo.map(async (r) => {
    const { data } = await db.rpc('buscar_producto_similar', { p_texto: r.desc });
    const best = Array.isArray(data) ? data[0] : data;
    return { r, best };
  }));
  for (const { r, best } of res) {
    if (r.ean) conEan++;
    const precio = Math.round(r.costo * 1.6);
    if (best && Number(best.similitud) >= TH) {
      match++;
      if (ejMatch.length < 12) ejMatch.push(`${r.desc}  →  ${best.nombre}  (sim ${Number(best.similitud).toFixed(2)})  costo $${r.costo} · venta $${precio}`);
    } else {
      nuevo++;
      if (ejNuevo.length < 12) ejNuevo.push(`${r.desc}  ·  costo $${r.costo} · venta $${precio}${r.ean ? ` · EAN ${r.ean}` : ''}`);
    }
  }
  process.stdout.write(`\r  procesados ${match + nuevo}/${rows.length}`);
}

console.log('\n\n===== RESUMEN ARCOR (previa, sin escribir) =====');
console.log(`Total: ${rows.length} · con EAN: ${conEan}`);
console.log(`MATCHEAN con catálogo (actualizar costo+precio): ${match}`);
console.log(`NUEVOS (no están, candidatos a alta): ${nuevo}`);
console.log('\n--- Ejemplos que MATCHEAN ---');
ejMatch.forEach((e) => console.log('  ✓ ' + e));
console.log('\n--- Ejemplos NUEVOS ---');
ejNuevo.forEach((e) => console.log('  + ' + e));
