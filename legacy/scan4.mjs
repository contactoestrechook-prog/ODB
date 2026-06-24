import MDBReader from 'mdb-reader';
import { readFileSync } from 'node:fs';
const r = new (MDBReader.default ?? MDBReader)(readFileSync('./climatizacion_copia.mdb'));
const sospech = [];
for (const n of r.getTableNames()) {
  let rc=null, dl=null;
  try { rc = r.getTable(n).rowCount; } catch {}
  try { dl = r.getTable(n).getData({rowLimit:1e6}).length; } catch(e){ dl='ERR:'+e.message; }
  if ((rc>0 && dl===0) || String(dl).startsWith('ERR')) sospech.push(`${n}: rowCount=${rc} leidas=${dl}`);
}
console.log('Tablas con rowCount>0 pero 0 leídas (o error):', sospech.length?('\n  '+sospech.join('\n  ')):'NINGUNA ✓');
// nombres de TODAS las tablas, por si hay una "barras/ean/codigos" que ignoré
console.log('\nTablas cuyo nombre sugiere códigos/barras:');
console.log('  ' + r.getTableNames().filter(n=>/barra|ean|cod|scan|lector/i.test(n)).join(', ') || '  (ninguna)');
