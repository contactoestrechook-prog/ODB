// Cada foto por tipo que propone lib/fotos.ts tiene que existir en public/cat.
// Una que no existe es un 404 por tarjeta y el producto termina con el logo.
// Corre antes del build: si falta un archivo, el deploy no sale.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const raiz = new URL('..', import.meta.url).pathname;

// lib/fotos.ts es TypeScript: en vez de importarlo, se lee el mapa DISPONIBLES
// y se compara contra los archivos que hay de verdad.
const texto = readFileSync(join(raiz, 'lib/fotos.ts'), 'utf8');
const bloque = texto.match(/const DISPONIBLES[^{]*\{([\s\S]*?)\};/);
if (!bloque) { console.error('No encontré el mapa DISPONIBLES en lib/fotos.ts'); process.exit(1); }

const declarados = {};
for (const [, tipo, n] of bloque[1].matchAll(/([a-z]+)\s*:\s*(\d+)/g)) declarados[tipo] = Number(n);

const reales = {};
for (const f of readdirSync(join(raiz, 'public/cat'))) {
  const m = f.match(/^([a-z]+)-(\d+)\.jpg$/);
  if (m) reales[m[1]] = Math.max(reales[m[1]] ?? 0, Number(m[2]));
}

const problemas = [];
for (const [tipo, n] of Object.entries(declarados)) {
  for (let i = 1; i <= n; i++) {
    if (!existsSync(join(raiz, `public/cat/${tipo}-${i}.jpg`))) problemas.push(`falta public/cat/${tipo}-${i}.jpg`);
  }
}
for (const [tipo, n] of Object.entries(reales)) {
  if ((declarados[tipo] ?? 0) < n) problemas.push(`hay ${n} tiles de "${tipo}" y DISPONIBLES declara ${declarados[tipo] ?? 0}: se están desperdiciando`);
}

if (problemas.length) { console.error('Fotos por tipo mal declaradas:\n  ' + problemas.join('\n  ')); process.exit(1); }
console.log(`Fotos por tipo: ${Object.keys(declarados).length} tipos, todas presentes.`);
