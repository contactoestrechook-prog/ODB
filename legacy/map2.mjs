import MDBReader from 'mdb-reader';
import { readFileSync, writeFileSync } from 'node:fs';
const buf = readFileSync('./climatizacion_copia.mdb');
const r = new (MDBReader.default ?? MDBReader)(buf);
const names = r.getTableNames().sort((a,b)=>a.localeCompare(b));
let out = `TOTAL TABLAS: ${names.length}\n\n=== TODAS LAS TABLAS (alfabético) ===\n`;
const meta = {};
for (const n of names) { try { const t=r.getTable(n); meta[n]={rows:t.rowCount, cols:t.getColumns()}; } catch(e){ meta[n]={rows:-1, cols:[], err:e.message}; } }
for (const n of names) out += `${String(meta[n].rows).padStart(7)}  ${n}  (${meta[n].cols.length} cols)\n`;
// columnas + muestra de tablas clave
const KEY = /^(cliente|repuestos|stockdep|MOVSTOCK|salidas|lfaccompras|listcompra|FACCOMPRAS|facturaeti|facturaimp|FACREPARTOS|vendedor|rubro|RUBROSTOCK|zona|zona1|ctactepro|auxliquidacion|DETSTOCK|LPEDIDOS|depositos|compras)$/i;
out += `\n\n=== COLUMNAS + MUESTRA (tablas clave) ===\n`;
for (const n of names.filter(x=>KEY.test(x))) {
  const t = r.getTable(n);
  out += `\n--- ${n}  (${meta[n].rows} filas) ---\n`;
  out += t.getColumns().map(c=>`${c.name}:${c.type}`).join(' | ') + '\n';
  try {
    const data = t.getData({rowLimit:1});
    if (data[0]) out += 'EJ: ' + JSON.stringify(Object.fromEntries(Object.entries(data[0]).map(([k,v])=>[k, String(v??'').slice(0,22)]))) + '\n';
  } catch(e){ out += '(sin muestra: '+e.message+')\n'; }
}
writeFileSync('./esquema.txt', out);
console.log(out.slice(0, 2600));
