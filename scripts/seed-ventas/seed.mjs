// Genera 60 días de historia de ventas realista para alimentar al Analista ODB.
// Corre con la service key (inserta directo, sin tocar el stock actual).
//   node seed.mjs
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../../apps/api/.env', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);
const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

// unidades por día típicas de cada producto (outlet de bebidas)
const PERFILES = {
  'CER-0001': 20, 'CER-0002': 6, 'GAS-0001': 15, 'GAS-0002': 8,
  'APE-0001': 10, 'AGU-0001': 12, 'ENE-0001': 9, 'VIN-0005': 3,
  'VIN-0003': 1.5, 'VIN-0004': 1.2, 'ESP-0002': 1, 'ESP-0003': 0.8,
  'VIN-0007': 0.9, 'WHI-0001': 0.4, 'VIN-0009': 0.6, 'VIN-0010': 0.5,
  'VIN-0011': 0.4, 'VIN-0008': 0.3, 'ESP-0001': 0.5, 'VIN-0002': 0.1,
};
const DIAS = 60;

const { data: productos } = await db
  .from('productos')
  .select('id, sku, costo')
  .in('sku', Object.keys(PERFILES));
const { data: sucursales } = await db.from('sucursales').select('id, nombre');
const { data: precios } = await db.rpc('catalogo_precios', {
  p_ids: productos.map((p) => p.id),
});
const precioPor = new Map(precios.map((r) => [r.producto_id, Number(r.precio_lista)]));

const ventas = [];
const items = [];
const pagos = [];
const medios = ['efectivo', 'mercadopago', 'tarjeta'];

for (const p of productos) {
  const ritmo = PERFILES[p.sku];
  for (let d = 1; d <= DIAS; d++) {
    const fecha = new Date(Date.now() - d * 86400_000);
    const finde = [5, 6].includes(fecha.getDay()) ? 1.6 : 1.0;
    for (const s of sucursales) {
      const parte = s.nombre === 'Sucursal 1' ? 0.6 : 0.4;
      const unidades = Math.round(ritmo * finde * parte * (0.6 + Math.random() * 0.8));
      if (unidades <= 0) continue;
      const precio = precioPor.get(p.id) ?? Number(p.costo) * 1.4;
      const total = Math.round(unidades * precio * 0.95 * 100) / 100;
      const id = crypto.randomUUID();
      const momento = new Date(fecha.getTime() + Math.random() * 12 * 3600_000).toISOString();
      ventas.push({
        id, sucursal_id: s.id, canal: 'mostrador', estado: 'completada',
        subtotal: total, descuento: 0, total, vendida_en: momento,
      });
      items.push({
        venta_id: id, producto_id: p.id, cantidad: unidades,
        precio_unitario: Math.round((total / unidades) * 100) / 100,
        costo_unitario: p.costo,
      });
      pagos.push({
        venta_id: id, medio: medios[Math.floor(Math.random() * 3)], monto: total,
      });
    }
  }
}

console.log(`Insertando ${ventas.length} ventas históricas…`);
for (const [tabla, filas] of [['ventas', ventas], ['ventas_items', items], ['pagos', pagos]]) {
  for (let i = 0; i < filas.length; i += 500) {
    const { error } = await db.from(tabla).insert(filas.slice(i, i + 500));
    if (error) throw new Error(`${tabla}: ${error.message}`);
  }
  console.log(`  ${tabla}: ${filas.length} filas`);
}

// Aumento de costos del proveedor LBA (la lista que analizamos: ~+16 %)
const { data: lba } = await db
  .from('proveedores')
  .select('id')
  .eq('razon_social', 'Logística de Bebidas Andina SA')
  .single();
const { error: errLista } = await db.rpc('aplicar_lista_proveedor', {
  p_proveedor: lba.id,
  p_items: [
    { sku: 'GAS-0001', costo: 2380 }, { sku: 'GAS-0002', costo: 2380 },
    { sku: 'AGU-0001', costo: 905 }, { sku: 'ENE-0001', costo: 1450 },
  ],
});
if (errLista) throw new Error(errLista.message);
console.log('Costos de LBA actualizados (+16 %). Listo.');
