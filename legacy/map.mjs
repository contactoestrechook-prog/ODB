import MDBReader from 'mdb-reader';
import { readFileSync } from 'node:fs';
const buf = readFileSync('./climatizacion_copia.mdb');
const r = new (MDBReader.default ?? MDBReader)(buf);
const names = r.getTableNames();
const info = [];
for (const n of names) {
  try {
    const t = r.getTable(n);
    const cols = t.getColumns().map(c => `${c.name}:${c.type}`);
    info.push({ n, rows: t.rowCount, ncols: cols.length, cols });
  } catch(e) { info.push({ n, rows: -1, ncols: 0, cols: ['<error '+e.message+'>'] }); }
}
info.sort((a,b)=>b.rows-a.rows);
console.log(`TOTAL TABLAS: ${names.length}\n`);
console.log('=== POR CANTIDAD DE FILAS (top 40) ===');
for (const x of info.slice(0,40)) console.log(String(x.rows).padStart(8), '·', x.n, `(${x.ncols} cols)`);
