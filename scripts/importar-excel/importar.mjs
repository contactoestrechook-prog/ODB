// Importador del catálogo ODB desde Excel.
//
// Uso:
//   npm install
//   cp mapeo.ejemplo.json mapeo.json   (y ajustar encabezados de columnas)
//   node importar.mjs --dry-run        → solo valida y genera reporte.csv
//   DATABASE_URL=postgres://... node importar.mjs   → inserta en la base
//
// La corrida en seco es obligatoria como práctica: con 13.000 filas siempre
// hay duplicados de código de barras, precios vacíos o filas basura.

import fs from 'node:fs';
import XLSX from 'xlsx';
import pg from 'pg';

const DRY_RUN = process.argv.includes('--dry-run');
const mapeo = JSON.parse(fs.readFileSync(new URL('./mapeo.json', import.meta.url)));
const col = mapeo.columnas;

const wb = XLSX.readFile(new URL(`./${mapeo.archivo}`, import.meta.url).pathname);
const hoja = wb.Sheets[mapeo.hoja ?? wb.SheetNames[0]];
const filas = XLSX.utils.sheet_to_json(hoja, { range: mapeo.fila_encabezados - 1, defval: null });

console.log(`Leídas ${filas.length} filas de "${mapeo.archivo}"`);

const limpiarNumero = (v) => {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return v;
  // "1.234,56" → 1234.56 (formato argentino habitual en Excels)
  const n = parseFloat(String(v).replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

const errores = [];
const codigosVistos = new Map();
const skusVistos = new Map();
const productos = [];

filas.forEach((fila, i) => {
  const nroFila = i + mapeo.fila_encabezados + 1;
  const nombre = fila[col.nombre]?.toString().trim();
  if (!nombre) {
    errores.push({ fila: nroFila, error: 'sin nombre/descripción', dato: JSON.stringify(fila).slice(0, 120) });
    return;
  }

  let sku = col.sku ? fila[col.sku]?.toString().trim() : null;
  if (!sku) sku = `ODB-${String(nroFila).padStart(6, '0')}`; // SKU sintético si el Excel no trae código
  if (skusVistos.has(sku)) {
    errores.push({ fila: nroFila, error: `SKU duplicado "${sku}" (ya en fila ${skusVistos.get(sku)})`, dato: nombre });
    return;
  }
  skusVistos.set(sku, nroFila);

  let codigoBarras = col.codigo_barras ? fila[col.codigo_barras]?.toString().trim() : null;
  if (codigoBarras) {
    if (!/^\d{8,14}$/.test(codigoBarras)) {
      errores.push({ fila: nroFila, error: `código de barras inválido "${codigoBarras}" (se importa el producto sin código)`, dato: nombre });
      codigoBarras = null;
    } else if (codigosVistos.has(codigoBarras)) {
      errores.push({ fila: nroFila, error: `código de barras duplicado "${codigoBarras}" (ya en fila ${codigosVistos.get(codigoBarras)}; se importa sin código)`, dato: nombre });
      codigoBarras = null;
    } else {
      codigosVistos.set(codigoBarras, nroFila);
    }
  }

  productos.push({
    sku,
    nombre,
    codigoBarras,
    marca: col.marca ? fila[col.marca]?.toString().trim() || null : null,
    categoria: col.categoria ? fila[col.categoria]?.toString().trim() || null : null,
    costo: limpiarNumero(col.costo && fila[col.costo]),
    precioMinorista: limpiarNumero(col.precio_minorista && fila[col.precio_minorista]),
    precioMayorista: limpiarNumero(col.precio_mayorista && fila[col.precio_mayorista]),
    stockSuc1: limpiarNumero(col.stock_sucursal_1 && fila[col.stock_sucursal_1]) ?? 0,
    stockSuc2: limpiarNumero(col.stock_sucursal_2 && fila[col.stock_sucursal_2]) ?? 0,
    volumenMl: limpiarNumero(col.volumen_ml && fila[col.volumen_ml]),
    unidadesPack: limpiarNumero(col.unidades_pack && fila[col.unidades_pack]) ?? 1,
  });
});

// Reporte siempre, dry-run o no
const reporte = [
  'fila;error;dato',
  ...errores.map((e) => `${e.fila};${e.error};${e.dato}`),
].join('\n');
fs.writeFileSync(new URL('./reporte.csv', import.meta.url), reporte);
console.log(`${productos.length} productos válidos, ${errores.length} observaciones → reporte.csv`);

if (DRY_RUN) {
  console.log('Dry-run: no se insertó nada. Revisá reporte.csv y corré sin --dry-run.');
  process.exit(0);
}

if (!process.env.DATABASE_URL) {
  console.error('Falta DATABASE_URL. Ejemplo: DATABASE_URL=postgres://user:pass@host:5432/odb node importar.mjs');
  process.exit(1);
}

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
await db.query('begin');
try {
  const { rows: sucursales } = await db.query('select id from sucursales order by creado_en nulls last, nombre limit 2');
  if (sucursales.length < 1) throw new Error('Cargar las sucursales en la tabla `sucursales` antes de importar.');

  const { rows: [listaMin] } = await db.query(
    `insert into listas_precios (nombre) values ('Minorista')
     on conflict do nothing returning id`,
  );
  const listaMinId = listaMin?.id ?? (await db.query(`select id from listas_precios where nombre='Minorista'`)).rows[0].id;

  let insertados = 0;
  for (const p of productos) {
    let marcaId = null;
    if (p.marca) {
      const { rows } = await db.query(
        `insert into marcas (nombre) values ($1) on conflict (nombre) do update set nombre=excluded.nombre returning id`,
        [p.marca],
      );
      marcaId = rows[0].id;
    }
    let categoriaId = null;
    if (p.categoria) {
      const { rows } = await db.query(
        `with existente as (select id from categorias where nombre=$1 and padre_id is null),
              nueva as (insert into categorias (nombre) select $1 where not exists (select 1 from existente) returning id)
         select id from existente union all select id from nueva`,
        [p.categoria],
      );
      categoriaId = rows[0].id;
    }

    const { rows: [prod] } = await db.query(
      `insert into productos (sku, nombre, marca_id, categoria_id, costo, volumen_ml, unidades_pack)
       values ($1,$2,$3,$4,$5,$6,$7) returning id`,
      [p.sku, p.nombre, marcaId, categoriaId, p.costo, p.volumenMl, p.unidadesPack],
    );

    if (p.codigoBarras) {
      await db.query(`insert into codigos_barras (codigo, producto_id) values ($1,$2)`, [p.codigoBarras, prod.id]);
    }
    if (p.precioMinorista != null) {
      await db.query(`insert into precios (lista_id, producto_id, precio) values ($1,$2,$3)`, [listaMinId, prod.id, p.precioMinorista]);
    }

    const stocks = [[sucursales[0]?.id, p.stockSuc1], [sucursales[1]?.id, p.stockSuc2]];
    for (const [sucId, cant] of stocks) {
      if (!sucId) continue;
      await db.query(`insert into stock (producto_id, sucursal_id, cantidad) values ($1,$2,$3)`, [prod.id, sucId, cant]);
      if (cant !== 0) {
        await db.query(
          `insert into movimientos_stock (producto_id, sucursal_id, tipo, cantidad, motivo, referencia_tipo)
           values ($1,$2,'ajuste',$3,'carga inicial desde Excel','importacion')`,
          [prod.id, sucId, cant],
        );
      }
    }
    insertados++;
    if (insertados % 1000 === 0) console.log(`  ${insertados}/${productos.length}...`);
  }

  await db.query('commit');
  console.log(`Importación completa: ${insertados} productos insertados.`);
} catch (err) {
  await db.query('rollback');
  console.error('Error — se revirtió todo (rollback):', err.message);
  process.exit(1);
} finally {
  await db.end();
}
