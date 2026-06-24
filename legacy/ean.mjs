import MDBReader from 'mdb-reader';
import { readFileSync } from 'node:fs';
const r = new (MDBReader.default ?? MDBReader)(readFileSync('./climatizacion_copia.mdb'));
const rep = r.getTable('repuestos').getData({rowLimit:1e6});
const lp = r.getTable('lprecios').getData({rowLimit:1e6});
// columnas de repuestos
console.log('repuestos cols:', r.getTable('repuestos').getColumns().map(c=>c.name).join(', '));
// ¿algún campo con valores tipo EAN (12-13 dígitos)?
const ean = /^\d{12,13}$/;
const campos = ['codigo','codigopro','codbarra','codigoc'];
for (const t of [['repuestos',rep],['lprecios',lp]]) {
  const [nom, data] = t;
  const cols = Object.keys(data[0]||{});
  for (const c of cols) {
    const conEan = data.filter(x=>ean.test(String(x[c]??'').trim())).length;
    if (conEan>0) console.log(`  ${nom}.${c}: ${conEan} valores tipo EAN (12-13 díg)`);
  }
  // muestra de codigo
  console.log(`  ${nom}.codigo ejemplos:`, data.slice(0,5).map(x=>x.codigo).join(', '));
}
