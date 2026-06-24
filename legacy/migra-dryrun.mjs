import MDBReader from 'mdb-reader';
import { readFileSync } from 'node:fs';
const r = new (MDBReader.default ?? MDBReader)(readFileSync('./climatizacion_copia.mdb'));
const num = v => { const n = Number(String(v ?? '').replace(/[^0-9.,-]/g,'').replace(/\.(?=\d{3}\b)/g,'').replace(',', '.')); return isNaN(n)?0:n; };
const lp = r.getTable('lprecios').getData({rowLimit:1e6});
const rep = r.getTable('repuestos').getData({rowLimit:1e6});

// índice por código
const repByCod = new Map();
for (const x of rep) { const c=String(x.codigo).trim(); if(c) repByCod.set(c, x); }
const cat = new Map(); // codigo -> producto unificado
function up(c, base){ if(!cat.has(c)) cat.set(c, base); else Object.assign(cat.get(c), Object.fromEntries(Object.entries(base).filter(([k,v])=>v!=null && v!=='' ))); }

for (const x of lp) {
  const c = String(x.codigo).trim(); if(!c) continue;
  up(c, { codigo:c, nombre:(x.articulo||'').trim(), rubro:(x.rubro||'').trim()||null, precio:num(x.precio) });
}
for (const x of rep) {
  const c = String(x.codigo).trim(); if(!c) continue;
  up(c, { codigo:c, nombre:(x.descripcion||'').trim(), rubro:(x.rubro||'').trim()||null,
    costo:num(x.pcosto), stock:num(x.CANTIDAD), pventa:num(x.pventa), pventa2:num(x.pventa2), pventa3:num(x.pventa3),
    unidades_pack: num(x.caja)||null, marca:(x.marca||'').trim()||null });
}
const prods = [...cat.values()].filter(p=>p.nombre);
// precio final: lprecios.precio, si no pventa
prods.forEach(p=>{ p.precioFinal = p.precio>0 ? p.precio : (p.pventa>0?p.pventa:0); });

const ALC=/(vino|malbec|cabernet|syrah|merlot|bonarda|tinto|blanco|rosado|espumante|champ|whisky|whiskey|cerveza|ipa|lager|fernet|gin|ginebra|vodka|ron|tequila|licor|aperitivo|vermut|vermouth|chandon|aperol|campari|gancia|coñac|cognac|grappa|sidra|prosecco|cava)/i;
prods.forEach(p=>{ p.es_alcohol = ALC.test(p.rubro||'') || ALC.test(p.nombre||''); });

const rubros = new Map(); prods.forEach(p=>{ const k=p.rubro||'(sin rubro)'; rubros.set(k,(rubros.get(k)||0)+1); });

console.log('=== DRY-RUN MIGRACIÓN CATÁLOGO ===');
console.log('Productos únicos (lprecios ∪ repuestos):', prods.length);
console.log('  con precio >0:', prods.filter(p=>p.precioFinal>0).length);
console.log('  con costo >0 :', prods.filter(p=>p.costo>0).length);
console.log('  con stock >0 :', prods.filter(p=>p.stock>0).length);
console.log('  marcados alcohol:', prods.filter(p=>p.es_alcohol).length);
console.log('  solo en lprecios:', prods.filter(p=>!repByCod.has(p.codigo)).length, '| en repuestos:', prods.filter(p=>repByCod.has(p.codigo)).length);
console.log('RUBROS → categorías:', rubros.size);
console.log('  vinos (rubro contiene vino):', prods.filter(p=>/vino/i.test(p.rubro||'')).length);
const ps = prods.map(p=>p.precioFinal).filter(v=>v>0).sort((a,b)=>a-b);
console.log('PRECIOS: min', ps[0], '| mediana', ps[Math.floor(ps.length/2)], '| max', ps[ps.length-1]);
console.log('\nEJEMPLOS (10):');
prods.filter(p=>p.precioFinal>0).slice(0,10).forEach(p=>console.log(` [${p.codigo}] ${String(p.nombre).slice(0,34).padEnd(34)} $${p.precioFinal}  costo:${p.costo||'-'} stock:${p.stock||'-'} ${p.es_alcohol?'🍷':''} (${p.rubro||'sin rubro'})`));
console.log('\nTOP 12 RUBROS:');
[...rubros.entries()].sort((a,b)=>b[1]-a[1]).slice(0,12).forEach(([k,v])=>console.log(String(v).padStart(5), k));
