// Promueve a productos del catálogo los ítems de las bases de proveedor que NO
// matchearon Y que no tienen ningún similar decente (genuinamente nuevos), para
// no crear duplicados. Los crea priceados (costo*1.6) y linkeados al proveedor.
//   node promover-nuevos.mjs
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../../apps/api/.env', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);
const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const MARKUP = 1.6;
const ALCOHOL = new Set(['Vinotecas', 'Codorníu Argentina', 'EG (Lista E36)', 'Lista L41']);
const UMBRAL_DUP = 0.3; // si hay un similar >= esto, NO lo creamos (probable duplicado)

const { data: items } = await db
  .from('listas_proveedor_items')
  .select('id, descripcion, costo, lista:listas_proveedor(proveedor:proveedores(id, razon_social))')
  .is('sku', null);
console.log(`Ítems sin match en base: ${items.length}`);

const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const uniq = []; const vist = new Set();
for (const it of items) { const k = norm(it.descripcion); if (vist.has(k) || !(Number(it.costo) > 0)) continue; vist.add(k); uniq.push(it); }
console.log(`Únicos con costo: ${uniq.length}`);

// genuinamente nuevos (sin similar decente)
const nuevos = []; const cola = [...uniq];
await Promise.all(Array.from({ length: 8 }, async () => {
  while (cola.length) {
    const it = cola.shift();
    const { data: sim } = await db.rpc('buscar_producto_similar', { p_texto: it.descripcion }).maybeSingle();
    if (!sim || sim.similitud < UMBRAL_DUP) nuevos.push(it);
  }
}));
console.log(`Genuinamente nuevos: ${nuevos.length} · probables duplicados saltados: ${uniq.length - nuevos.length}`);

// crear productos
const filas = nuevos.map((it) => ({
  sku: 'LP-' + it.id.slice(0, 8).toUpperCase(),
  nombre: it.descripcion,
  es_alcohol: ALCOHOL.has(it.lista?.proveedor?.razon_social),
}));
for (let i = 0; i < filas.length; i += 200) {
  const { error } = await db.from('productos').insert(filas.slice(i, i + 200));
  if (error) throw new Error(error.message);
}
console.log(`Productos creados: ${filas.length}`);

// aplicar costo + precio por proveedor
const porProv = new Map();
nuevos.forEach((it, idx) => {
  const provId = it.lista?.proveedor?.id; if (!provId) return;
  if (!porProv.has(provId)) porProv.set(provId, []);
  porProv.get(provId).push({ sku: filas[idx].sku, costo: Number(it.costo), precio: Math.round(Number(it.costo) * MARKUP * 100) / 100 });
});
let aplicados = 0;
for (const [provId, arr] of porProv) {
  for (let i = 0; i < arr.length; i += 200) {
    const { data } = await db.rpc('aplicar_lista_con_precio', { p_proveedor: provId, p_items: arr.slice(i, i + 200) });
    aplicados += data ?? 0;
  }
}
console.log(`Precios aplicados: ${aplicados}`);
console.log('Muestra:');
for (const f of filas.slice(0, 6)) console.log(`  + ${f.nombre}${f.es_alcohol ? ' 🍷' : ''}`);
console.log('LISTO ✓ (los nuevos quedan SIN STOCK hasta que se cargue existencia)');
