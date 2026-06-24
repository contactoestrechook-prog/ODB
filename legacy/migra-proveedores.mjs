// Cimiento del módulo Proveedores PRO sobre el catálogo nuevo.
// 1) DRINK SOLUTIONS (proveedor principal del legacy) + sus 1.455 productos/costos (por codigo).
// 2) Re-vincula las listas de proveedores (Luvik/DEM/...) al catálogo ACTIVO por nombre exacto.
import MDBReader from 'mdb-reader';
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const env = Object.fromEntries(readFileSync('../apps/api/.env','utf8').split('\n')
  .map(l=>l.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean).map(m=>[m[1], m[2].replace(/^["']|["']$/g,'')]));
const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, { auth:{ persistSession:false } });
const num = v => { const n = Number(String(v ?? '').replace(/[^0-9.,-]/g,'').replace(/\.(?=\d{3}\b)/g,'').replace(',', '.')); return isNaN(n)?0:n; };
const norm = s => (s||'').toString().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
const chunk = (a,n)=>{ const o=[]; for(let i=0;i<a.length;i+=n) o.push(a.slice(i,i+n)); return o; };

// productos activos: id, codigo_legacy, nombre
const actives=[]; for(let f=0;;f+=1000){ const {data,error}=await db.from('productos').select('id,codigo_legacy,nombre').eq('activo',true).range(f,f+999); if(error)throw error; actives.push(...data); if(data.length<1000)break; }
const byCod=new Map(actives.filter(p=>p.codigo_legacy).map(p=>[p.codigo_legacy,p.id]));
const byName=new Map(); actives.forEach(p=>{ const k=norm(p.nombre); if(k&&!byName.has(k)) byName.set(k,p.id); });
console.log('productos activos:', actives.length, '| por codigo:', byCod.size, '| por nombre:', byName.size);

// 1) DRINK SOLUTIONS
let { data: drink } = await db.from('proveedores').select('id').ilike('razon_social','drink solutions').maybeSingle();
if(!drink){ const { data, error } = await db.from('proveedores').insert({ razon_social:'DRINK SOLUTIONS', activo:true, condicion_pago:'CONTADO', descuento_efectivo:0 }).select('id').single(); if(error)throw error; drink=data; console.log('DRINK SOLUTIONS creado'); }
const DRINK = drink.id;
const rep = new (MDBReader.default ?? MDBReader)(readFileSync('./climatizacion_copia.mdb')).getTable('repuestos').getData({rowLimit:1e6});
await db.from('proveedor_productos').delete().eq('proveedor_id', DRINK);
const seenD=new Set(); const drinkRows=[];
for(const x of rep){ const c=String(x.codigo).trim(); const id=byCod.get(c); const co=num(x.pcosto); if(id&&co>0&&!seenD.has(id)){ seenD.add(id); drinkRows.push({ producto_id:id, proveedor_id:DRINK, codigo_proveedor:c, ultimo_costo:co }); } }
for(const c of chunk(drinkRows,500)){ const {error}=await db.from('proveedor_productos').insert(c); if(error)throw new Error('drink pp: '+error.message); }
console.log('DRINK SOLUTIONS → productos vinculados:', drinkRows.length);

// 2) re-vincular listas al catálogo activo
const { data: listas } = await db.from('listas_proveedor').select('id,proveedor_id');
const provByLista = new Map(listas.map(l=>[l.id,l.proveedor_id]));
const provIds = [...new Set(listas.map(l=>l.proveedor_id))];
await db.from('proveedor_productos').delete().in('proveedor_id', provIds);  // limpia los huérfanos (apuntaban a inactivos)
const { data: items } = await db.from('listas_proveedor_items').select('lista_id,descripcion,costo');
const seen=new Set(); const rows=[]; let match=0;
for(const it of items){ const pid=byName.get(norm(it.descripcion)); const prov=provByLista.get(it.lista_id); const co=num(it.costo);
  if(pid&&prov&&co>0){ match++; const k=pid+'|'+prov; if(!seen.has(k)){ seen.add(k); rows.push({ producto_id:pid, proveedor_id:prov, ultimo_costo:co }); } } }
for(const c of chunk(rows,500)){ const {error}=await db.from('proveedor_productos').insert(c); if(error)throw new Error('lista pp: '+error.message); }
console.log(`listas: ${items.length} items, ${match} matchearon al catálogo activo → ${rows.length} links`);

// verificación: productos con 2+ proveedores (sobre activos)
const { data: multi } = await db.rpc ? {data:null} : {data:null};
const { count: total } = await db.from('proveedor_productos').select('*',{count:'exact',head:true});
console.log('proveedor_productos total ahora:', total);
console.log('LISTO (verificar solapamiento por SQL).');
