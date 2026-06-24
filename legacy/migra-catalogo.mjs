// Migración total del catálogo: legacy (climatizacion.mdb: lprecios ∪ repuestos) → Supabase.
// Reversible: keyea por codigo_legacy, NO borra; al final DESACTIVA los productos de relleno
// (activo=false) en vez de eliminarlos (preserva historial demo y FKs).
import MDBReader from 'mdb-reader';
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const LISTA_MINORISTA = 'f0f17a57-e55e-40a3-881d-41afeba7cb73';
const SUC_CENTRAL = '229906e6-df69-48eb-b027-2b57fefb89fe';
const DRY = process.argv.includes('--dry');

// ---- env (apps/api/.env) ----
const env = Object.fromEntries(readFileSync('../apps/api/.env','utf8').split('\n')
  .map(l=>l.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean).map(m=>[m[1], m[2].replace(/^["']|["']$/g,'')]));
const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, { auth:{ persistSession:false } });

// ---- helpers ----
const num = v => { const n = Number(String(v ?? '').replace(/[^0-9.,-]/g,'').replace(/\.(?=\d{3}\b)/g,'').replace(',', '.')); return isNaN(n)?0:n; };
const norm = s => (s||'').toString().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/\s+/g,' ').trim();
const chunk = (a,n)=>{ const o=[]; for(let i=0;i<a.length;i+=n) o.push(a.slice(i,i+n)); return o; };
const ALC=/(vino|malbec|cabernet|syrah|merlot|bonarda|tinto|blanco|rosado|espumante|champ|whisky|whiskey|cerveza|ipa|lager|fernet|gin|ginebra|vodka|ron|tequila|licor|aperitivo|vermut|vermouth|chandon|aperol|campari|gancia|cognac|grappa|sidra|prosecco|cava)/i;

// ---- 1. leer legacy ----
const r = new (MDBReader.default ?? MDBReader)(readFileSync('./climatizacion_copia.mdb'));
const lp = r.getTable('lprecios').getData({rowLimit:1e6});
const rep = r.getTable('repuestos').getData({rowLimit:1e6});
const cat = new Map();
const up=(c,b)=>{ if(!cat.has(c)) cat.set(c,b); else Object.assign(cat.get(c), Object.fromEntries(Object.entries(b).filter(([k,v])=>v!=null&&v!==''))); };
for (const x of lp){ const c=String(x.codigo).trim(); if(c) up(c,{codigo:c, nombre:(x.articulo||'').trim(), rubro:(x.rubro||'').trim()||null, precio:num(x.precio)}); }
for (const x of rep){ const c=String(x.codigo).trim(); if(c) up(c,{codigo:c, nombre:(x.descripcion||'').trim(), rubro:(x.rubro||'').trim()||null, costo:num(x.pcosto), stock:num(x.CANTIDAD), stockmin:num(x.stockmin), pventa:num(x.pventa), unidades_pack:num(x.caja)||null}); }
const prods = [...cat.values()].filter(p=>p.nombre);
prods.forEach(p=>{ p.precioFinal = p.precio>0?p.precio:(p.pventa>0?p.pventa:0); p.es_alcohol = ALC.test(p.rubro||'')||ALC.test(p.nombre||''); });
console.log(`legacy: ${prods.length} productos (${prods.filter(p=>p.precioFinal>0).length} con precio, ${prods.filter(p=>p.stock>0).length} con stock)`);

// ---- 2. categorías: match por nombre, crear faltantes ----
let { data: cats } = await db.from('categorias').select('id,nombre');
const catByNorm = new Map((cats||[]).map(c=>[norm(c.nombre), c.id]));
const rubros = [...new Set(prods.map(p=>p.rubro).filter(Boolean))];
const faltan = rubros.filter(ru=>!catByNorm.has(norm(ru)));
console.log(`categorías: ${cats?.length||0} existentes, ${rubros.length} rubros legacy, ${faltan.length} a crear`);
if (!DRY && faltan.length){
  for (const c of chunk(faltan,200)){
    const { data, error } = await db.from('categorias').insert(c.map(nombre=>({nombre}))).select('id,nombre');
    if (error) throw new Error('cat insert: '+error.message);
    data.forEach(c=>catByNorm.set(norm(c.nombre), c.id));
  }
  console.log(`  creadas ${faltan.length} categorías`);
}
const catId = ru => ru ? (catByNorm.get(norm(ru))||null) : null;

if (DRY){ console.log('DRY-RUN: no se escribe nada más.'); process.exit(0); }

// ---- 3. upsert productos por codigo_legacy ----
let okP=0;
for (const c of chunk(prods, 500)){
  const rows = c.map(p=>({
    sku: 'L'+p.codigo, codigo_legacy: p.codigo, nombre: p.nombre,
    categoria_id: catId(p.rubro), costo: p.costo||0, es_alcohol: !!p.es_alcohol,
    unidades_pack: p.unidades_pack||1, alicuota_iva: 21, activo: true,
  }));
  const { error } = await db.from('productos').upsert(rows, { onConflict:'codigo_legacy' });
  if (error) throw new Error('prod upsert: '+error.message);
  okP += rows.length; process.stdout.write(`\r  productos: ${okP}/${prods.length}`);
}
console.log('');

// map codigo_legacy -> id
const idByCod = new Map();
for (const c of chunk(prods.map(p=>p.codigo), 800)){
  const { data, error } = await db.from('productos').select('id,codigo_legacy').in('codigo_legacy', c);
  if (error) throw new Error('prod select: '+error.message);
  data.forEach(p=>idByCod.set(p.codigo_legacy, p.id));
}
console.log(`  ids mapeados: ${idByCod.size}`);

// ---- 4. precios (Minorista): borrar los previos de estos productos + insertar ----
const idsLegacy = [...idByCod.values()];
for (const c of chunk(idsLegacy, 500)) await db.from('precios').delete().eq('lista_id', LISTA_MINORISTA).in('producto_id', c);
const preciosRows = prods.filter(p=>p.precioFinal>0 && idByCod.get(p.codigo)).map(p=>({ producto_id: idByCod.get(p.codigo), lista_id: LISTA_MINORISTA, precio: p.precioFinal }));
let okPr=0;
for (const c of chunk(preciosRows, 500)){
  const { error } = await db.from('precios').insert(c);
  if (error) throw new Error('precios insert: '+error.message);
  okPr += c.length; process.stdout.write(`\r  precios: ${okPr}/${preciosRows.length}`);
}
console.log('');

// ---- 5. stock (O.D.B Central): borrar previos + insertar los con stock ----
for (const c of chunk(idsLegacy, 500)) await db.from('stock').delete().eq('sucursal_id', SUC_CENTRAL).in('producto_id', c);
const stockRows = prods.filter(p=>p.stock>0 && idByCod.get(p.codigo)).map(p=>({ producto_id: idByCod.get(p.codigo), sucursal_id: SUC_CENTRAL, cantidad: p.stock, stock_minimo: p.stockmin||0 }));
let okS=0;
for (const c of chunk(stockRows, 500)){
  const { error } = await db.from('stock').insert(c);
  if (error) throw new Error('stock insert: '+error.message);
  okS += c.length;
}
console.log(`  stock: ${okS} filas (O.D.B Central)`);

// ---- 6. guarda + desactivar los de relleno ----
const { count: nLegacy } = await db.from('productos').select('*',{count:'exact',head:true}).not('codigo_legacy','is',null);
console.log(`\nproductos legacy activos: ${nLegacy}`);
if (nLegacy >= 9000){
  const { error, count } = await db.from('productos').update({ activo:false }, {count:'exact'}).is('codigo_legacy', null).eq('activo', true);
  if (error) throw new Error('desactivar: '+error.message);
  console.log(`DESACTIVADOS ${count} productos de relleno (reversible: activo=false).`);
} else {
  console.log('⚠ menos de 9000 legacy → NO desactivo los viejos (revisar).');
}
console.log('LISTO.');
