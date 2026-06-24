import MDBReader from 'mdb-reader';
import { readFileSync } from 'node:fs';
const r = new (MDBReader.default ?? MDBReader)(readFileSync('./climatizacion_copia.mdb'));
const names = r.getTableNames();
console.log('=== chequeo rowCount vs filas leídas + errores ===');
const rows = [];
for (const n of names) {
  let rc=null, dl=null, err=null;
  try { const t=r.getTable(n); rc=t.rowCount; } catch(e){ err='count:'+e.message; }
  try { const t=r.getTable(n); dl=t.getData({rowLimit:1000000}).length; } catch(e){ err=(err||'')+' data:'+e.message; }
  rows.push({n, rc, dl, err});
}
// mostrar las que tienen error o discrepancia o son grandes
const interes = rows.filter(x=>x.err || x.rc!==x.dl || (x.rc>500));
for (const x of interes.sort((a,b)=>(b.rc||0)-(a.rc||0))) console.log(String(x.rc).padStart(7),'rc | leídas',String(x.dl).padStart(7), x.err?('⚠ '+x.err):'', '·', x.n);
console.log('\nTOTAL filas sumadas (todas):', rows.reduce((s,x)=>s+(x.dl||0),0));

// repuestos: rubros y vinos
try {
  const rep = r.getTable('repuestos').getData({rowLimit:1000000});
  const porRubro = {}; rep.forEach(p=>{const k=p.rubro||'(sin)'; porRubro[k]=(porRubro[k]||0)+1;});
  const top = Object.entries(porRubro).sort((a,b)=>b[1]-a[1]);
  console.log('\n=== repuestos por rubro (top 15 de', Object.keys(porRubro).length,'rubros) ===');
  top.slice(0,15).forEach(([k,v])=>console.log(String(v).padStart(5), k));
  const vinos = rep.filter(p=>/vino/i.test(p.rubro||'')).length;
  console.log('-> filas con rubro que contiene "vino":', vinos);
} catch(e){ console.log('repuestos err', e.message); }
