import MDBReader from 'mdb-reader';
import { readFileSync } from 'node:fs';
const r = new (MDBReader.default ?? MDBReader)(readFileSync('./climatizacion_copia.mdb'));
const ean = /^\d{8}$|^\d{12,13}$/;  // EAN-8, UPC-12, EAN-13
const hits = [];
for (const n of r.getTableNames()) {
  let data;
  try { data = r.getTable(n).getData({rowLimit:1e6}); } catch { continue; }
  if (!data.length) continue;
  const cols = Object.keys(data[0]);
  for (const c of cols) {
    let cnt = 0, ej = '';
    for (const row of data) { const v = String(row[c] ?? '').trim(); if (ean.test(v)) { cnt++; if(!ej) ej=v; } }
    if (cnt >= 3) hits.push({ tabla:n, col:c, cant:cnt, total:data.length, ej });
  }
}
hits.sort((a,b)=>b.cant-a.cant);
console.log('Columnas con valores tipo código de barras (EAN/UPC):');
hits.slice(0,20).forEach(h=>console.log(`  ${h.tabla}.${h.col}: ${h.cant}/${h.total}  ej ${h.ej}`));
if(!hits.length) console.log('  NINGUNA. (no hay EAN en el .mdb)');
