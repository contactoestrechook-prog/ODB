// Importador del inventario real de ODB (stock inventario 12-06.xls)
// Estructura: Codigo (interno) · Descripcion · Rubro · Pack (= stock actual)
// Sin precios ni códigos de barras: llegan después con las listas de proveedores.
//   node importar-real.mjs --dry-run   → analiza sin tocar la base
//   node importar-real.mjs             → importa
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync } from 'node:fs';
import XLSX from 'xlsx';

const DRY = process.argv.includes('--dry-run');
const ARCHIVO = '/Users/leandroalonso/Downloads/stock inventario 12-06.xls';

const env = Object.fromEntries(
  readFileSync(new URL('../../apps/api/.env', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);
const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

// rubros que implican alcohol (venta solo +18)
const ALCOHOL = /vino|espumante|champagne|whisky|whiskies|licor|aperitivo|gin\b|ginebra|vodka|ron\b|tequila|cerveza|sidra|fernet|bitter|vermouth|vermut|cognac|brandy|grappa|aguardiente|sake|alcohol/i;
// rubros perecederos (control de vencimiento)
const PERECEDERO = /fiambre|queso|helado|pescader|huevo|lacteo|lácteo|frescos|congelado|embutido|sandwich|comida/i;

const wb = XLSX.readFile(ARCHIVO);
const filas = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null });

const vistos = new Map();
const productos = [];
const observaciones = [];
for (let i = 6; i < filas.length; i++) {
  const f = filas[i];
  const codigo = f[0] != null ? String(f[0]).trim() : null;
  const nombre = f[2] != null ? String(f[2]).trim().replace(/\s+/g, ' ') : null;
  if (!codigo || !nombre) continue;
  if (vistos.has(codigo)) {
    observaciones.push(`fila ${i + 1}: código ${codigo} duplicado ("${nombre}" vs "${vistos.get(codigo)}") — se conserva el primero`);
    continue;
  }
  vistos.set(codigo, nombre);

  const rubro = f[8] != null ? String(f[8]).trim() : 'Sin rubro';
  let stock = Number(f[11]);
  if (!Number.isFinite(stock)) stock = 0;
  if (stock < 0) {
    observaciones.push(`fila ${i + 1}: ${codigo} "${nombre}" con stock NEGATIVO (${stock}) — se importa en 0, revisar en el sistema viejo`);
    stock = 0;
  }
  productos.push({ codigo, nombre, rubro, stock });
}

const rubros = [...new Set(productos.map((p) => p.rubro))];
console.log(`Artículos a importar: ${productos.length} · rubros: ${rubros.length} · observaciones: ${observaciones.length}`);
console.log(`Con stock: ${productos.filter((p) => p.stock > 0).length} · en cero: ${productos.filter((p) => p.stock === 0).length}`);
console.log(`Detectados como alcohol (+18): ${productos.filter((p) => ALCOHOL.test(p.rubro)).length}`);
console.log(`Perecederos (control vencimiento): ${productos.filter((p) => PERECEDERO.test(p.rubro)).length}`);
writeFileSync(new URL('./reporte-real.txt', import.meta.url), observaciones.join('\n'));
console.log('Observaciones → reporte-real.txt');

if (DRY) {
  console.log('\nDRY RUN: no se tocó la base.');
  process.exit(0);
}

// --- categorías ---
const { data: catsExist } = await db.from('categorias').select('id, nombre');
const catPor = new Map((catsExist ?? []).map((c) => [c.nombre, c.id]));
const nuevas = rubros.filter((r) => !catPor.has(r)).map((nombre) => ({ nombre, margen_sugerido: 35 }));
for (let i = 0; i < nuevas.length; i += 200) {
  const { data, error } = await db.from('categorias').insert(nuevas.slice(i, i + 200)).select('id, nombre');
  if (error) throw new Error('categorias: ' + error.message);
  for (const c of data) catPor.set(c.nombre, c.id);
}
console.log(`Categorías: ${nuevas.length} nuevas (total ${catPor.size})`);

// --- productos (upsert por sku: re-correr es seguro) ---
const { data: sucursales } = await db.from('sucursales').select('id, nombre').order('nombre');
const filasProductos = productos.map((p) => ({
  sku: p.codigo,
  nombre: p.nombre,
  categoria_id: catPor.get(p.rubro),
  es_alcohol: ALCOHOL.test(p.rubro),
  controla_vencimiento: PERECEDERO.test(p.rubro),
}));
let importados = 0;
for (let i = 0; i < filasProductos.length; i += 500) {
  const lote = filasProductos.slice(i, i + 500);
  const { error } = await db.from('productos').upsert(lote, { onConflict: 'sku', ignoreDuplicates: false });
  if (error) throw new Error(`productos lote ${i}: ` + error.message);
  importados += lote.length;
  if (importados % 2000 < 500) console.log(`  productos: ${importados}/${filasProductos.length}`);
}

// --- stock (todo en Sucursal 1, que es donde se tomó el inventario; S2 en 0) ---
const todosIds = [];
for (let desde = 0; ; desde += 1000) {
  const { data, error } = await db.from('productos').select('id, sku').range(desde, desde + 999);
  if (error) throw new Error('leyendo ids: ' + error.message);
  todosIds.push(...(data ?? []));
  if (!data || data.length < 1000) break;
}
const idPor = new Map(todosIds.map((r) => [r.sku, r.id]));
const stockPor = new Map(productos.map((p) => [p.codigo, p.stock]));

const filasStock = [];
for (const p of productos) {
  const id = idPor.get(p.codigo);
  if (!id) continue;
  filasStock.push({ producto_id: id, sucursal_id: sucursales[0].id, cantidad: p.stock, stock_minimo: 0, punto_reposicion: 0 });
  filasStock.push({ producto_id: id, sucursal_id: sucursales[1].id, cantidad: 0, stock_minimo: 0, punto_reposicion: 0 });
}
let stockOk = 0;
for (let i = 0; i < filasStock.length; i += 500) {
  const { error } = await db.from('stock').upsert(filasStock.slice(i, i + 500), { onConflict: 'producto_id,sucursal_id' });
  if (error) throw new Error(`stock lote ${i}: ` + error.message);
  stockOk += Math.min(500, filasStock.length - i);
}
console.log(`Stock: ${stockOk} filas (2 sucursales)`);

// --- movimiento de carga inicial (auditoría) solo para stock > 0 ---
const movimientos = productos
  .filter((p) => p.stock > 0 && idPor.get(p.codigo))
  .map((p) => ({
    producto_id: idPor.get(p.codigo),
    sucursal_id: sucursales[0].id,
    tipo: 'ajuste',
    cantidad: p.stock,
    motivo: 'carga inicial: inventario 12-06',
    referencia_tipo: 'importacion',
  }));
for (let i = 0; i < movimientos.length; i += 500) {
  const { error } = await db.from('movimientos_stock').insert(movimientos.slice(i, i + 500));
  if (error) throw new Error(`movimientos lote ${i}: ` + error.message);
}
console.log(`Movimientos de carga inicial: ${movimientos.length}`);
console.log('IMPORTACIÓN COMPLETA ✓');