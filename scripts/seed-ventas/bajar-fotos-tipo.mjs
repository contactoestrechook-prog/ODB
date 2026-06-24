// Baja VARIAS fotos reales por TIPO desde Open Food Facts (datos abiertos) a
// apps/web/public/cat/<tipo>-<n>.jpg, para dar variedad (no todos iguales).
//   node bajar-fotos-tipo.mjs
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';

const DEST = new URL('../../apps/web/public/cat/', import.meta.url);
try { rmSync(DEST, { recursive: true, force: true }); } catch {}
mkdirSync(DEST, { recursive: true });

// [tipo, término de búsqueda, cantidad de variantes]
const TIPOS = [
  ['vino', 'vino tinto', 5], ['espumante', 'espumante brut', 3], ['cerveza', 'cerveza rubia', 4],
  ['fernet', 'fernet', 2], ['whisky', 'whisky', 2], ['gin', 'gin', 2], ['aperitivo', 'aperitivo', 2],
  ['gaseosa', 'gaseosa cola', 3], ['agua', 'agua mineral', 2], ['jugo', 'jugo naranja', 2],
  ['queso', 'queso', 4], ['fiambre', 'jamon cocido', 4], ['aceitunas', 'aceitunas', 3],
  ['aceite', 'aceite girasol', 2], ['mayonesa', 'mayonesa', 2], ['fideos', 'fideos', 3],
  ['arroz', 'arroz', 2], ['harina', 'harina trigo', 2], ['yerba', 'yerba mate', 2],
  ['cafe', 'cafe', 2], ['galletitas', 'galletitas', 3], ['chocolate', 'chocolate', 3],
  ['snacks', 'papas fritas', 2], ['leche', 'leche', 2], ['conservas', 'atun lata', 2],
  ['limpieza', 'detergente', 2],
];

const UA = { 'User-Agent': 'ODB-Premium-Market/1.0 (demo)' };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function urls(q, n) {
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(`https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=24&fields=image_front_url`, { headers: UA });
      const d = await r.json();
      const out = [];
      for (const p of d.products ?? []) { if (p.image_front_url && !out.includes(p.image_front_url)) out.push(p.image_front_url); if (out.length >= n) break; }
      return out;
    } catch { await wait(2500); }
  }
  return [];
}

const conteo = {};
for (const [tipo, q, n] of TIPOS) {
  const us = await urls(q, n);
  let k = 0;
  for (const u of us) {
    try {
      const im = await fetch(u, { headers: UA });
      const b = Buffer.from(await im.arrayBuffer());
      if (b.length > 2500) { k++; writeFileSync(new URL(`${tipo}-${k}.jpg`, DEST), b); }
    } catch {}
    await wait(250);
  }
  conteo[tipo] = k;
  console.log(`  ${tipo}: ${k}/${n}`);
  await wait(1800);
}
console.log('\nCONTEO =', JSON.stringify(conteo));
