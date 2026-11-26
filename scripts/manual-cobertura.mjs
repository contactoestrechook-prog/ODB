#!/usr/bin/env node
// CANDADO DEL MANUAL (Leandro, 26/11/2026: «necesitamos un manual súper intuitivo
// para el modo dueño de cómo usar todo el sistema 100% actualizado»).
//
// Cada pantalla del menú (GRUPOS de apps/admin/app/ui/Header.tsx) tiene que
// tener al menos una sección del manual que la explique (`pantallas: [...]` en
// apps/admin/app/manual/*.ts). Y ninguna sección puede apuntar a una pantalla
// que ya no está en el menú. Si falla, scripts/publicar.sh no publica.
//
// Uso: node scripts/manual-cobertura.mjs [raíz del repo]
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const raiz = process.argv[2] ?? process.cwd();
const header = readFileSync(join(raiz, 'apps/admin/app/ui/Header.tsx'), 'utf8');
const desde = header.indexOf('export const GRUPOS');
const hasta = header.indexOf('export const TITULOS');
if (desde < 0 || hasta < 0) { console.error('CANDADO MANUAL: no encuentro GRUPOS ni TITULOS en Header.tsx'); process.exit(1); }
const menu = [...header.slice(desde, hasta).matchAll(/href: '([^']+)'/g)].map((m) => m[1]);
// las de «Mi cuenta», abajo del menú: también tienen que estar explicadas
const pie = ['/avisos', '/cambiar-clave']; // el manual está en el menú desde el 26/11

const dirManual = join(raiz, 'apps/admin/app/manual');
const explicadas = new Map(); // href → [ids]
for (const f of readdirSync(dirManual).filter((x) => x.endsWith('.ts'))) {
  const src = readFileSync(join(dirManual, f), 'utf8');
  for (const m of src.matchAll(/\n\s+id: '([^']+)',[\s\S]*?\n\s+pantallas: \[([^\]]*)\]/g)) {
    for (const h of [...m[2].matchAll(/'([^']+)'/g)].map((x) => x[1])) {
      explicadas.set(h, [...(explicadas.get(h) ?? []), m[1]]);
    }
  }
}

const faltan = [...menu, ...pie].filter((h) => !explicadas.has(h));
const sobran = [...explicadas.keys()].filter((h) => !menu.includes(h) && !pie.includes(h));

if (faltan.length || sobran.length) {
  if (faltan.length) {
    console.error('CANDADO MANUAL: estas pantallas del menú no tienen explicación en el manual:');
    for (const h of faltan) console.error(`  - ${h}`);
    console.error('  Sumá una sección (o su href en `pantallas` de una existente) en apps/admin/app/manual/.');
  }
  if (sobran.length) {
    console.error('CANDADO MANUAL: el manual explica pantallas que ya no están en el menú:');
    for (const h of sobran) console.error(`  - ${h} (en ${explicadas.get(h).join(', ')})`);
  }
  process.exit(1);
}
console.log(`Manual: las ${menu.length + pie.length} pantallas tienen su explicación.`);
