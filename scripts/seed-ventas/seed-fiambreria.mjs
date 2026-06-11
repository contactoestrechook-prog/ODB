// Fiambrería ODB: productos perecederos con lotes y vencimientos + historia de ventas.
//   node seed-fiambreria.mjs
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

// [sku, nombre, marca, categoria, costo, ritmo venta/día, lotes: [días hasta vencer, cantidad]]
const FIAMBRERIA = [
  ['FIA-0001', 'Jamón crudo feteado 200 g', 'Cagnoli', 'Fiambres', 5200, 6, [[8, 18], [35, 30]]],
  ['FIA-0002', 'Salame Milán feteado 200 g', 'Cagnoli', 'Fiambres', 3100, 8, [[12, 24], [40, 36]]],
  ['FIA-0003', 'Bondiola feteada 200 g', 'Paladini', 'Fiambres', 3800, 4, [[6, 12], [30, 20]]],
  ['FIA-0004', 'Mortadela con pistacho 250 g', 'Paladini', 'Fiambres', 2200, 3, [[15, 15], [45, 25]]],
  ['QUE-0001', 'Queso pategrás media horma 500 g', 'La Serenísima', 'Quesos', 6400, 5, [[20, 16], [60, 24]]],
  ['QUE-0002', 'Queso azul 200 g', 'Santa Rosa', 'Quesos', 3900, 2, [[10, 8], [50, 14]]],
  ['QUE-0003', 'Queso brie 180 g', 'Santa Rosa', 'Quesos', 4600, 1.5, [[9, 6], [55, 12]]],
  ['PIC-0001', 'Aceitunas verdes descarozadas 300 g', 'Nucete', 'Picadas', 1900, 5, [[90, 50]]],
  ['PIC-0002', 'Maní japonés 500 g', 'Krachitos', 'Picadas', 1600, 7, [[120, 60]]],
  ['PIC-0003', 'Grisines artesanales 250 g', 'La Espiga', 'Picadas', 1100, 6, [[25, 30], [70, 40]]],
];

const { data: cats } = await db.from('categorias').select('id, nombre');
const catPor = new Map(cats.map((c) => [c.nombre, c.id]));
for (const nombre of ['Fiambres', 'Quesos', 'Picadas']) {
  if (!catPor.has(nombre)) {
    const { data } = await db
      .from('categorias')
      .insert({ nombre, margen_sugerido: 45 })
      .select('id')
      .single();
    catPor.set(nombre, data.id);
  }
}

const marcasUnicas = [...new Set(FIAMBRERIA.map((f) => f[1]))];
const { data: marcasExist } = await db.from('marcas').select('id, nombre');
const marcaPor = new Map(marcasExist.map((m) => [m.nombre, m.id]));
for (const nombre of marcasUnicas) {
  if (!marcaPor.has(nombre)) {
    const { data } = await db.from('marcas').insert({ nombre }).select('id').single();
    marcaPor.set(nombre, data.id);
  }
}

const { data: lista } = await db.from('listas_precios').select('id').eq('nombre', 'Minorista').single();
const { data: sucursales } = await db.from('sucursales').select('id, nombre');

const ventas = [], items = [], pagos = [];
let creados = 0;

for (const [sku, nombre, marca, cat, costo, ritmo, lotes] of FIAMBRERIA) {
  const { data: existente } = await db.from('productos').select('id').eq('sku', sku).maybeSingle();
  if (existente) continue;

  const { data: prod } = await db
    .from('productos')
    .insert({
      sku, nombre,
      marca_id: marcaPor.get(marca),
      categoria_id: catPor.get(cat),
      es_alcohol: false,
      controla_vencimiento: true,
      costo,
    })
    .select('id')
    .single();
  creados++;

  const precio = Math.round((costo * 1.5) / 10) * 10;
  await db.from('precios').insert({ lista_id: lista.id, producto_id: prod.id, precio });

  for (const s of sucursales) {
    const stockTotal = lotes.reduce((a, [, c]) => a + c, 0);
    const parte = s.nombre === 'Sucursal 1' ? 0.6 : 0.4;
    await db.from('stock').insert({
      producto_id: prod.id,
      sucursal_id: s.id,
      cantidad: Math.round(stockTotal * parte),
      stock_minimo: 6,
      punto_reposicion: 12,
    });
    for (let li = 0; li < lotes.length; li++) {
      const [dias, cantidad] = lotes[li];
      await db.from('lotes').insert({
        producto_id: prod.id,
        sucursal_id: s.id,
        lote: `L${sku.slice(-2)}${li + 1}`,
        vencimiento: new Date(Date.now() + dias * 86400_000).toISOString().slice(0, 10),
        cantidad: Math.round(cantidad * parte),
      });
    }
  }

  // historia de ventas 45 días
  for (let d = 1; d <= 45; d++) {
    const fecha = new Date(Date.now() - d * 86400_000);
    const finde = [5, 6].includes(fecha.getDay()) ? 1.7 : 1.0;
    for (const s of sucursales) {
      const parte = s.nombre === 'Sucursal 1' ? 0.6 : 0.4;
      const unidades = Math.round(ritmo * finde * parte * (0.6 + Math.random() * 0.8));
      if (unidades <= 0) continue;
      const total = Math.round(unidades * precio * 100) / 100;
      const id = crypto.randomUUID();
      ventas.push({
        id, sucursal_id: s.id, canal: 'mostrador', estado: 'completada',
        subtotal: total, descuento: 0, total,
        vendida_en: new Date(fecha.getTime() + Math.random() * 12 * 3600_000).toISOString(),
      });
      items.push({
        venta_id: id, producto_id: prod.id, cantidad: unidades,
        precio_unitario: precio, costo_unitario: costo,
      });
      pagos.push({ venta_id: id, medio: 'efectivo', monto: total });
    }
  }
}

for (const [tabla, filas] of [['ventas', ventas], ['ventas_items', items], ['pagos', pagos]]) {
  for (let i = 0; i < filas.length; i += 500) {
    const { error } = await db.from(tabla).insert(filas.slice(i, i + 500));
    if (error) throw new Error(`${tabla}: ${error.message}`);
  }
}
console.log(`Fiambrería: ${creados} productos creados, ${ventas.length} ventas históricas, lotes con vencimientos cargados.`);