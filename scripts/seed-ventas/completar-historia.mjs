import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
const env = Object.fromEntries(readFileSync(new URL('../../apps/api/.env', import.meta.url), 'utf8').split('\n').filter(l=>l.includes('=')&&!l.startsWith('#')).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1)]));
const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

const RITMOS = { 'FIA-0001':6,'FIA-0002':8,'FIA-0003':4,'FIA-0004':3,'QUE-0001':5,'QUE-0002':2,'QUE-0003':1.5,'PIC-0001':5,'PIC-0002':7,'PIC-0003':6 };

const { data: prods } = await db.from('productos').select('id, sku, costo').in('sku', Object.keys(RITMOS));
const { data: sucursales } = await db.from('sucursales').select('id, nombre');
const { data: precios } = await db.rpc('catalogo_precios', { p_ids: prods.map(p=>p.id) });
const precioPor = new Map(precios.map(r=>[r.producto_id, Number(r.precio_lista)]));

const ventas = [], items = [], pagos = [];
for (const p of prods) {
  const { count } = await db.from('ventas_items').select('venta_id', { count: 'exact', head: true }).eq('producto_id', p.id);
  if (count > 0) { console.log(p.sku, 'ya tiene historia, salteo'); continue; }
  const precio = precioPor.get(p.id) ?? Number(p.costo) * 1.5;
  for (let d = 1; d <= 45; d++) {
    const fecha = new Date(Date.now() - d * 86400_000);
    const finde = [5,6].includes(fecha.getDay()) ? 1.7 : 1.0;
    for (const s of sucursales) {
      const parte = s.nombre === 'Sucursal 1' ? 0.6 : 0.4;
      const unidades = Math.round(RITMOS[p.sku] * finde * parte * (0.6 + Math.random() * 0.8));
      if (unidades <= 0) continue;
      const total = Math.round(unidades * precio * 100) / 100;
      const id = crypto.randomUUID();
      ventas.push({ id, sucursal_id: s.id, canal: 'mostrador', estado: 'completada', subtotal: total, descuento: 0, total, vendida_en: new Date(fecha.getTime() + Math.random()*12*3600_000).toISOString() });
      items.push({ venta_id: id, producto_id: p.id, cantidad: unidades, precio_unitario: precio, costo_unitario: p.costo });
      pagos.push({ venta_id: id, medio: 'efectivo', monto: total });
    }
  }
}
for (const [tabla, filas] of [['ventas', ventas], ['ventas_items', items], ['pagos', pagos]]) {
  for (let i = 0; i < filas.length; i += 500) {
    const { error } = await db.from(tabla).insert(filas.slice(i, i + 500));
    if (error) throw new Error(tabla + ': ' + error.message);
  }
}
console.log('Historia completada:', ventas.length, 'ventas de fiambrería');
