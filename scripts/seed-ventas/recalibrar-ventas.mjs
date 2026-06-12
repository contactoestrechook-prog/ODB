// Recalibra la historia de ventas a la volumetría REAL de ODB:
// ~340 ventas/día · ticket promedio ~$42.000 (dato del dueño, 12/6/2026).
// Usa los productos reales valorizados. Reemplaza la historia sintética anterior.
//   node recalibrar-ventas.mjs
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const DIAS = 30;
const VENTAS_DIA = 340;
const TICKET_OBJETIVO = 42_000;

const env = Object.fromEntries(
  readFileSync(new URL('../../apps/api/.env', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);
const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

// --- limpiar historia anterior (es toda sintética) ---
console.log('Limpiando historia sintética anterior…');
for (const tabla of ['pagos', 'ventas_items', 'comprobantes_arca']) {
  const { error } = await db.from(tabla).delete().neq('venta_id', '00000000-0000-0000-0000-000000000000');
  if (error) throw new Error(tabla + ': ' + error.message);
}
{
  const { error } = await db.from('ventas').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  if (error) throw new Error('ventas: ' + error.message);
}

// --- productos valorizados con su precio vigente ---
const productos = [];
for (let desde = 0; ; desde += 1000) {
  const { data, error } = await db
    .from('productos')
    .select('id, sku, costo')
    .not('costo', 'is', null)
    .eq('activo', true)
    .range(desde, desde + 999);
  if (error) throw new Error(error.message);
  productos.push(...(data ?? []));
  if (!data || data.length < 1000) break;
}
const precioPor = new Map();
for (let i = 0; i < productos.length; i += 400) {
  const { data } = await db.rpc('catalogo_precios', { p_ids: productos.slice(i, i + 400).map((p) => p.id) });
  for (const r of data ?? []) if (r.precio_final) precioPor.set(r.producto_id, Number(r.precio_final));
}
const vendibles = productos.filter((p) => precioPor.get(p.id) > 0);
console.log(`Productos vendibles con precio: ${vendibles.length}`);

const { data: sucursales } = await db.from('sucursales').select('id, nombre').order('nombre');
const MEDIOS = [
  ['tarjeta', 0.35], ['mercadopago', 0.3], ['efectivo', 0.3], ['cta_cte', 0.05],
];
const elegirMedio = () => {
  let r = Math.random();
  for (const [m, p] of MEDIOS) { if ((r -= p) <= 0) return m; }
  return 'efectivo';
};
// ticket lognormal-ish alrededor del objetivo
const objetivoTicket = () => {
  const base = TICKET_OBJETIVO * Math.exp((Math.random() - 0.45) * 0.9);
  return Math.max(4000, Math.min(base, 350_000));
};

const ventas = [], items = [], pagos = [];
for (let d = DIAS; d >= 1; d--) {
  const fecha = new Date(Date.now() - d * 86400_000);
  const finde = [5, 6].includes(fecha.getDay()) ? 1.3 : 1.0;
  const n = Math.round(VENTAS_DIA * finde * (0.85 + Math.random() * 0.3));
  for (let v = 0; v < n; v++) {
    const id = crypto.randomUUID();
    const sucursal = sucursales[Math.random() < 0.6 ? 0 : 1].id;
    const objetivo = objetivoTicket();
    const renglones = new Map();
    let total = 0;
    let intentos = 0;
    while (total < objetivo * 0.85 && intentos < 25) {
      intentos++;
      const p = vendibles[Math.floor(Math.random() * vendibles.length)];
      const precio = precioPor.get(p.id);
      const cantidad = precio < 3000 ? 1 + Math.floor(Math.random() * 6) : 1 + Math.floor(Math.random() * 2);
      const previo = renglones.get(p.id);
      renglones.set(p.id, {
        producto_id: p.id,
        cantidad: (previo?.cantidad ?? 0) + cantidad,
        precio_unitario: precio,
        costo_unitario: p.costo,
      });
      total += Math.round(precio * cantidad * 100) / 100;
    }
    total = Math.round(total * 100) / 100;
    // hora comercial 9-21 con picos mediodía y tarde
    const hora = [10, 11, 12, 12, 13, 17, 18, 18, 19, 19, 20, 20][Math.floor(Math.random() * 12)];
    const momento = new Date(fecha);
    momento.setHours(hora, Math.floor(Math.random() * 60), Math.floor(Math.random() * 60));

    ventas.push({
      id, sucursal_id: sucursal, canal: 'mostrador', estado: 'completada',
      subtotal: total, descuento: 0, total, vendida_en: momento.toISOString(),
    });
    for (const r of renglones.values()) items.push({ venta_id: id, ...r });
    pagos.push({ venta_id: id, medio: elegirMedio(), monto: total });
  }
}
console.log(`Generadas ${ventas.length} ventas · ${items.length} renglones`);
const promedio = ventas.reduce((s, v) => s + v.total, 0) / ventas.length;
console.log(`Ticket promedio simulado: $${Math.round(promedio).toLocaleString('es-AR')}`);

for (const [tabla, filas] of [['ventas', ventas], ['ventas_items', items], ['pagos', pagos]]) {
  for (let i = 0; i < filas.length; i += 500) {
    const { error } = await db.from(tabla).insert(filas.slice(i, i + 500));
    if (error) throw new Error(`${tabla} lote ${i}: ` + error.message);
  }
  console.log(`  ${tabla}: ${filas.length}`);
}
console.log('RECALIBRACIÓN COMPLETA ✓');