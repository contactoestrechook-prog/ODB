import MDBReader from 'mdb-reader';
import { readFileSync } from 'node:fs';
const r = new (MDBReader.default ?? MDBReader)(readFileSync('./climatizacion_copia.mdb'));
const num = v => { const n = Number(String(v ?? '').replace(/[^0-9.,-]/g,'').replace(/\.(?=\d{3}\b)/g,'').replace(',', '.')); return isNaN(n)?0:n; };
const rep = r.getTable('repuestos').getData({rowLimit:1e6});
const lfa = r.getTable('lfaccompras').getData({rowLimit:1e6});
const mov = r.getTable('MOVSTOCK').getData({rowLimit:1e6});
const lc  = r.getTable('listcompra').getData({rowLimit:1e6});

const isEmp = s => /\bodb\b/i.test(s);
const isCanal = s => /(cliente|local|pedidos ya|mostrador|consumidor|particular|varios)/i.test(s);
const tipo = s => isEmp(s) ? 'empleado' : (isCanal(s) ? 'canal' : 'real');

// universo de nombres
const nombres = new Set();
[...rep.map(x=>x.proveedor), ...lfa.map(x=>x.PROVEEDOR), ...lc.map(x=>x.proveedor), ...mov.map(x=>x.proveedor)]
  .map(v=>String(v??'').trim()).filter(Boolean).forEach(n=>nombres.add(n));
const clasif = { real:[], empleado:[], canal:[] };
[...nombres].forEach(n=>clasif[tipo(n)].push(n));
console.log('=== CLASIFICACIÓN DE NOMBRES (', nombres.size, 'distintos) ===');
console.log('  proveedores REALES:', clasif.real.length, '| empleados:', clasif.empleado.length, '| canales:', clasif.canal.length);
console.log('  empleados:', clasif.empleado.slice(0,12).join(', '));
console.log('  canales  :', clasif.canal.join(', '));

// stats por proveedor REAL desde repuestos (productos + costo) y lfaccompras (historial)
const real = new Set(clasif.real.map(s=>s.toLowerCase()));
const prodPorProv = {}, costoProv = {};
for (const x of rep){ const p=String(x.proveedor??'').trim(); if(p && real.has(p.toLowerCase())){ prodPorProv[p]=(prodPorProv[p]||0)+1; } }
const compras = {};
for (const x of lfa){ const p=String(x.PROVEEDOR??'').trim(); if(!p||!real.has(p.toLowerCase())) continue;
  const f=new Date(x.FECHA), t=num(x.TOTAL);
  const o = compras[p] ||= {n:0,total:0,min:null,max:null};
  o.n++; o.total+=t; if(!isNaN(f)){ if(!o.min||f<o.min)o.min=f; if(!o.max||f>o.max)o.max=f; }
}
console.log('\n=== TOP 12 PROVEEDORES REALES por COMPRADO (lfaccompras) ===');
Object.entries(compras).sort((a,b)=>b[1].total-a[1].total).slice(0,12).forEach(([p,o])=>
  console.log(` $${Math.round(o.total).toLocaleString('es-AR').padStart(14)} | ${String(o.n).padStart(4)} compras | ${o.min?o.min.toISOString().slice(0,7):'?'}→${o.max?o.max.toISOString().slice(0,7):'?'} | ${prodPorProv[p]||0} prod | ${p}`));

// productos con MÚLTIPLES proveedores (MOVSTOCK: codigo -> set proveedores reales, con costo)
const porCod = {};
for (const x of mov){ const c=String(x.CODIGO??'').trim(), p=String(x.proveedor??'').trim(), co=num(x.costo); if(!c||!p||!real.has(p.toLowerCase())) continue; (porCod[c] ||= {desc:String(x.DESCRIPCION||'').slice(0,26), provs:{}}); if(co>0) porCod[c].provs[p]=Math.min(porCod[c].provs[p]??1e15, co); }
const multi = Object.entries(porCod).filter(([c,o])=>Object.keys(o.provs).length>=2);
console.log('\n=== PRODUCTOS CON 2+ PROVEEDORES (MOVSTOCK, con costo) ===');
console.log('  cantidad:', multi.length);
multi.slice(0,8).forEach(([c,o])=>{ const e=Object.entries(o.provs).sort((a,b)=>a[1]-b[1]); const ahorro=Math.round((1-e[0][1]/e[e.length-1][1])*100); console.log(`  [${c}] ${o.desc} → ${e.map(([p,v])=>p.slice(0,14)+':$'+v).join(' vs ')}  (ahorro ${ahorro}%)`); });
console.log('\nTOTAL comprado histórico (real):', '$'+Math.round(Object.values(compras).reduce((s,o)=>s+o.total,0)).toLocaleString('es-AR'));
