import MDBReader from 'mdb-reader';
import { readFileSync } from 'node:fs';
const r = new (MDBReader.default ?? MDBReader)(readFileSync('./climatizacion_copia.mdb'));
const num = v => { const n = Number(String(v ?? '').replace(/[^0-9.,-]/g,'').replace(/\.(?=\d{3}\b)/g,'').replace(',', '.')); return isNaN(n)?0:n; };
const rep = r.getTable('repuestos').getData({rowLimit:1e6});
const isEmp = s => /\bodb\b/i.test(s);
const isCanal = s => /(cliente|local|pedidos ya|mostrador|consumidor|particular|varios|^\s*$)/i.test(s);

const prov = {};
let sinProv=0;
for (const x of rep){
  const p=String(x.proveedor??'').trim();
  if(!p){ sinProv++; continue; }
  if(isEmp(p)||isCanal(p)) continue;
  const o = prov[p] ||= {prod:0, conStock:0, costoStock:0, rubros:new Set()};
  o.prod++; const st=num(x.CANTIDAD), co=num(x.pcosto);
  if(st>0){ o.conStock++; o.costoStock += st*co; }
  if(x.rubro) o.rubros.add(String(x.rubro).trim());
}
const arr = Object.entries(prov).sort((a,b)=>b[1].prod-a[1].prod);
console.log('=== PROVEEDORES REALES (desde repuestos.proveedor) ===');
console.log('proveedores reales:', arr.length, '| productos sin proveedor:', sinProv);
console.log('\nTOP 15 por # productos:');
arr.slice(0,15).forEach(([p,o])=>console.log(` ${String(o.prod).padStart(4)} prod | ${String(o.conStock).padStart(3)} c/stock | val.stock $${Math.round(o.costoStock).toLocaleString('es-AR').padStart(12)} | ${o.rubros.size} rubros | ${p}`));
console.log('\nresumen: prod totales con proveedor real:', arr.reduce((s,[,o])=>s+o.prod,0));
console.log('valor de inventario total (costo×stock):', '$'+Math.round(arr.reduce((s,[,o])=>s+o.costoStock,0)).toLocaleString('es-AR'));
