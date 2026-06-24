import MDBReader from 'mdb-reader';
import { readFileSync } from 'node:fs';
const r = new (MDBReader.default ?? MDBReader)(readFileSync('./climatizacion_copia.mdb'));
const num = v => Number(String(v??'').replace(',','.'))||0;
const lp = r.getTable('lprecios').getData({rowLimit:1e6});
const rep = r.getTable('repuestos').getData({rowLimit:1e6});
const lpCods = lp.map(x=>String(x.codigo).trim()).filter(Boolean);
const repCods = rep.map(x=>String(x.codigo).trim()).filter(Boolean);
const lpSet = new Set(lpCods), repSet = new Set(repCods);
console.log('lprecios: filas', lp.length, '| códigos distintos', lpSet.size);
console.log('repuestos: filas', rep.length, '| códigos distintos', repSet.size);
const enAmbos = [...repSet].filter(c=>lpSet.has(c)).length;
console.log('repuestos cuyo código está en lprecios:', enAmbos, '/', repSet.size);
const soloRep = [...repSet].filter(c=>!lpSet.has(c)).length;
console.log('códigos en repuestos pero NO en lprecios:', soloRep);
// ¿lprecios tiene 1 fila por producto o varias listas?
const dup = lpCods.length - lpSet.size;
console.log('lprecios filas duplicadas por código:', dup, '(0 = una fila por producto)');
// precios: ¿precio2/3/4 se usan? (listas)
const conP2 = lp.filter(x=>num(x.precio2)>0).length, conP3=lp.filter(x=>num(x.precio3)>0).length, conP4=lp.filter(x=>num(x.precio4)>0).length, conCosto=lp.filter(x=>num(x.pcosto)>0).length;
console.log('lprecios -> con precio2>0:',conP2,'| precio3>0:',conP3,'| precio4>0:',conP4,'| pcosto>0:',conCosto);
// stock: ¿está en repuestos.CANTIDAD?
console.log('repuestos con stock>0:', rep.filter(x=>num(x.CANTIDAD)>0).length, '| con pcosto>0:', rep.filter(x=>num(x.pcosto)>0).length);
