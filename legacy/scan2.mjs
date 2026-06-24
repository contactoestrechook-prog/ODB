import MDBReader from 'mdb-reader';
import { readFileSync } from 'node:fs';
const r = new (MDBReader.default ?? MDBReader)(readFileSync('./climatizacion_copia.mdb'));
const errores = [];
const hits = [];
for (const n of r.getTableNames()) {
  let data;
  try { data = r.getTable(n).getData({rowLimit:1e6}); }
  catch(e){ errores.push(n+': '+e.message); continue; }
  if (!data.length) continue;
  const cols = Object.keys(data[0]);
  for (const c of cols) {
    let max=0, maxv='', dig13=0, dig8=0;
    for (const row of data) {
      const v = String(row[c] ?? '').trim();
      if (v.length>max){max=v.length;maxv=v;}
      if (/^\d{12,14}$/.test(v)) dig13++;
      else if (/^\d{8}$/.test(v)) dig8++;
    }
    if (dig13>0 || dig8>2) hits.push({t:n,c,dig13,dig8,maxv:maxv.slice(0,16)});
  }
}
console.log('TABLAS QUE FALLAN AL LEER:', errores.length?errores.join(' | '):'ninguna');
console.log('\nColumnas con valores 12-14 díg (EAN-13/UPC) o varios de 8 díg:');
hits.sort((a,b)=>b.dig13-a.dig13);
hits.slice(0,25).forEach(h=>console.log(`  ${h.t}.${h.c}: 13d=${h.dig13} 8d=${h.dig8} maxej=${h.maxv}`));
if(!hits.length) console.log('  ninguna');
