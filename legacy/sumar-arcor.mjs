// Suma Arcor SOLO como proveedor + guarda su lista como REFERENCIA (con EAN).
// NO aplica costos ni precios al catálogo: el % se carga al recibir la mercadería (regla de oro).
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const env = Object.fromEntries(readFileSync('../apps/api/.env', 'utf8').split('\n')
  .map((l) => l.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].replace(/^["']|["']$/g, '')]));
const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const chunk = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };

const rows = JSON.parse(readFileSync('/tmp/arcor.json', 'utf8'));

// 1) proveedor (idempotente por razón social)
let { data: prov } = await db.from('proveedores').select('id').ilike('razon_social', 'Arcor').maybeSingle();
if (!prov) {
  const { data, error } = await db.from('proveedores').insert({ razon_social: 'Arcor', activo: true }).select('id').single();
  if (error) throw new Error('proveedor: ' + error.message);
  prov = data;
  console.log('proveedor Arcor creado:', prov.id);
} else {
  console.log('proveedor Arcor ya existía:', prov.id);
}

// 2) lista de referencia (header) — sin markup (el precio se define al recibir)
const { data: lista, error: eL } = await db.from('listas_proveedor')
  .insert({ proveedor_id: prov.id, archivo: 'lista 102 junio.xls (referencia, sin remarcar)', items_total: rows.length, items_match: 0, markup: 1 })
  .select('id').single();
if (eL) throw new Error('lista: ' + eL.message);
console.log('lista de referencia creada:', lista.id);

// 3) items (codigo Arcor, descripción, bulto, costo de referencia c/IVA, EAN) — sin precio_sugerido ni vínculo a producto
let ok = 0;
for (const g of chunk(rows, 500)) {
  const { error } = await db.from('listas_proveedor_items').insert(g.map((r) => ({
    lista_id: lista.id,
    codigo: r.codigo || null,
    descripcion: r.desc,
    presentacion: r.bulto ? `bulto x ${r.bulto}` : null,
    costo: r.costo,
    ean: r.ean || null,
  })));
  if (error) throw new Error('items: ' + error.message);
  ok += g.length; process.stdout.write(`\r  items cargados: ${ok}/${rows.length}`);
}
console.log('\nLISTO. Arcor sumado como proveedor + lista de referencia (sin precios aplicados).');
console.log(`items: ${ok} · con EAN: ${rows.filter((r) => r.ean).length}`);
