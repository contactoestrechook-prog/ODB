import MDBReader from 'mdb-reader';
import { readFileSync } from 'node:fs';
const r = new (MDBReader.default ?? MDBReader)(readFileSync('./climatizacion_copia.mdb'));
const re13 = /\d{12,14}/;   // EAN/UPC como subcadena
const colHits = {};
let tablas=0;
for (const n of r.getTableNames()) {
  let data; try { data = r.getTable(n).getData({rowLimit:1e6}); } catch { continue; }
  if (!data.length) continue; tablas++;
  for (const c of Object.keys(data[0])) {
    for (const row of data) {
      const v = String(row[c] ?? '');
      const m = v.match(re13);
      if (m) { const k=n+'.'+c; (colHits[k] ||= {n:0, ej:m[0], full:v.slice(0,30)}); colHits[k].n++; }
    }
  }
}
console.log('tablas con datos escaneadas:', tablas);
const ents = Object.entries(colHits).sort((a,b)=>b[1].n-a[1].n);
console.log('Columnas con 12-14 dígitos en ALGÚN lado del valor:');
ents.slice(0,25).forEach(([k,v])=>console.log(`  ${k}: ${v.n} · ej "${v.ej}" (en "${v.full}")`));
if(!ents.length) console.log('  NINGUNA');
