// Migración de clientes: legacy cliente → Supabase clientes (keyed por codigo_legacy).
// Aditivo: no toca los clientes demo (codigo_legacy null). Preserva cta cte, reparto y envases.
import MDBReader from 'mdb-reader';
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const env = Object.fromEntries(readFileSync('../apps/api/.env','utf8').split('\n')
  .map(l=>l.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean).map(m=>[m[1], m[2].replace(/^["']|["']$/g,'')]));
const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, { auth:{ persistSession:false } });

const num = v => { const n = Number(String(v ?? '').replace(/[^0-9.,-]/g,'').replace(/\.(?=\d{3}\b)/g,'').replace(',', '.')); return isNaN(n)?0:n; };
const clean = v => { const s=String(v??'').trim(); return s||null; };
const chunk = (a,n)=>{ const o=[]; for(let i=0;i<a.length;i+=n) o.push(a.slice(i,i+n)); return o; };

const r = new (MDBReader.default ?? MDBReader)(readFileSync('./climatizacion_copia.mdb'));
const cli = r.getTable('cliente').getData({rowLimit:1e6});

const rows = [];
for (const c of cli) {
  const cod = String(c.ID ?? '').trim();
  const nombre = clean(c.NOMBRE);
  if (!cod || !nombre) continue;
  const saldo = num(c.saldo), deuda = num(c.deuda), fiado = num(c.fiado);
  const env_q = num(c.quimes1)+num(c.quilmes2), env_c = num(c.coca1)+num(c.coca2), env_b = num(c.budw1)+num(c.budw2);
  const dom = [clean(c.domicilio), clean(c.DOMICILIONUM), clean(c.LOCALIDAD), clean(c.provincia)].filter(Boolean).join(', ') || null;
  rows.push({
    codigo_legacy: cod,
    nombre,
    razon_social: clean(c.FANTASIA),
    cuit: clean(c.cuit),
    condicion_iva: (clean(c.iva) || 'CONSUMIDOR FINAL').toUpperCase(),
    telefono: clean(c.celular) || clean(c.TELEFONO) || clean(c.TELEFONO2),
    email: (c.email && String(c.email).includes('@')) ? String(c.email).trim().toLowerCase() : null,
    domicilio: dom,
    tipo: 'nuevo',
    verificado: false,
    puntos: 0,
    saldo_cta_cte: saldo,
    limite_cta_cte: 0,
    limite_credito: 0,
    cta_cte_habilitada: (saldo!==0 || deuda!==0 || fiado!==0),
    acepta_marketing: false,
    dia_reparto: clean(c.dia),
    zona_reparto: clean(c.zona),
    vendedor_reparto: clean(c.vendedor),
    barrio: clean(c.barrio),
    envases: (env_q||env_c||env_b) ? { quilmes: env_q, coca: env_c, budweiser: env_b } : null,
  });
}
console.log(`clientes legacy a migrar: ${rows.length} (de ${cli.length} filas)`);
console.log('  con cta cte:', rows.filter(r=>r.cta_cte_habilitada).length, '| con tel:', rows.filter(r=>r.telefono).length, '| con email:', rows.filter(r=>r.email).length, '| con envases:', rows.filter(r=>r.envases).length, '| con reparto(dia):', rows.filter(r=>r.dia_reparto).length);

let ok=0;
for (const c of chunk(rows, 500)){
  const { error } = await db.from('clientes').upsert(c, { onConflict:'codigo_legacy' });
  if (error) throw new Error('clientes upsert: '+error.message);
  ok += c.length; process.stdout.write(`\r  migrados: ${ok}/${rows.length}`);
}
console.log('');
const { count } = await db.from('clientes').select('*',{count:'exact',head:true}).not('codigo_legacy','is',null);
console.log(`clientes con codigo_legacy en la base: ${count}`);
console.log('LISTO.');
