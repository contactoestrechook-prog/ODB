import MDBReader from 'mdb-reader';
import { readFileSync } from 'node:fs';
const r = new (MDBReader.default ?? MDBReader)(readFileSync('./climatizacion_copia.mdb'));
const num = v => Number(String(v??'').replace(',','.'))||0;
const lp = r.getTable('lprecios');
console.log('lprecios columnas:', lp.getColumns().map(c=>`${c.name}:${c.type}`).join(' | '));
const data = lp.getData({rowLimit:1000000});
console.log('TOTAL filas:', data.length);
console.log('EJ 1:', JSON.stringify(Object.fromEntries(Object.entries(data[0]).map(([k,v])=>[k,String(v??'').slice(0,24)]))));
console.log('EJ 2:', JSON.stringify(Object.fromEntries(Object.entries(data[1]).map(([k,v])=>[k,String(v??'').slice(0,24)]))));
// detectar campo rubro/categoria y precio
const cols = lp.getColumns().map(c=>c.name);
const rubroCol = cols.find(c=>/rubro|categor|tipo/i.test(c));
const precioCols = cols.filter(c=>/precio|pventa|costo|pvta/i.test(c));
const descCol = cols.find(c=>/desc|nombre|articulo|producto/i.test(c));
console.log('campos -> rubro:', rubroCol, '| desc:', descCol, '| precios:', precioCols);
if (rubroCol){
  const byR={}; data.forEach(x=>{const k=x[rubroCol]||'(sin)'; byR[k]=(byR[k]||0)+1;});
  const top=Object.entries(byR).sort((a,b)=>b[1]-a[1]);
  console.log('rubros distintos:', Object.keys(byR).length);
  top.slice(0,15).forEach(([k,v])=>console.log(String(v).padStart(5),k));
  console.log('-> con "vino":', data.filter(x=>/vino/i.test(x[rubroCol]||'')).length);
}
const conPrecio = precioCols.length? data.filter(x=>precioCols.some(c=>num(x[c])>0)).length : 0;
console.log('con algún precio>0:', conPrecio);
