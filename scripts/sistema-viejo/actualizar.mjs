#!/usr/bin/env node
// Actualiza ODB con las planillas del SISTEMA VIEJO de Saint Thomas: la lista de
// precios ("precios st DD-MM.xls") y el inventario ("stock st DD-MM.xls").
//
// Es la sexta carga desde el sistema viejo (12/6, 20/6, 21/7, 11/8, 16/9, 1/10) y
// la primera con un script que queda en el repo. Junta lo que salió bien y lo que
// salió mal las otras veces:
//   - se cruza por productos.codigo_legacy (el sku es 'L' + código), nunca por sku;
//   - las columnas se ubican por el encabezado ('Codigo', 'Precio 1', 'Pack'): cambian
//     de lugar entre exportaciones;
//   - precios: se AGREGA una vigencia nueva en la lista Minorista (nunca UPDATE ni
//     DELETE: el 11/8 se perdió el historial de 1.682 precios); Precio 2 no se usa;
//   - stock (solo Saint Thomas): se ajusta por diferencia con registrar_movimiento,
//     así el libro de movimientos sigue cuadrando con el stock;
//   - no se aplica nada dudoso: códigos repetidos o reutilizados con otro nombre,
//     productos dados de baja, precios basura (0, 0,01) o saltos raros van a una
//     hoja de revisión para que el dueño decida.
//
// Uso (desde apps/api, que tiene el .env con SUPABASE_URL y SUPABASE_SERVICE_KEY):
//   node ../../scripts/sistema-viejo/actualizar.mjs --simular --precios <xls|json> --stock <xls|json> --salida <dir>
// El modo --aplicar está en aplicar.mjs y lee el plan que deja la simulación.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const XLSX = require(join(AQUI, '../importar-excel/node_modules/xlsx'));

const SUC_ST = '229906e6-df69-48eb-b027-2b57fefb89fe'; // Suc Sant Thomas
const PISO_PRECIO = 100;          // por debajo: casi seguro un marcador del sistema viejo (0, 0,01) o un precio viejo
const SALTO_MAX = 0.6;            // más de ±60%: se revisa antes de aplicar
const PARECIDO_MIN = 0.34;        // nombres que no se parecen nada: código reutilizado

// ---------------------------------------------------------------- argumentos
const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
const RUTA_PRECIOS = arg('--precios'), RUTA_STOCK = arg('--stock'), SALIDA = arg('--salida') ?? '.';
if (!process.argv.includes('--simular') || !RUTA_PRECIOS || !RUTA_STOCK) {
  console.error('Uso: actualizar.mjs --simular --precios <xls|json> --stock <xls|json> --salida <dir>');
  process.exit(1);
}

// ---------------------------------------------------------------- conexión
function env() {
  const e = { ...process.env };
  if (existsSync('.env')) for (const l of readFileSync('.env', 'utf8').split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(l.trim()); if (m && !e[m[1]]) e[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return e;
}
const E = env();
const URL_DB = E.SUPABASE_URL, CLAVE = E.SUPABASE_SERVICE_KEY;
if (!URL_DB || !CLAVE) { console.error('Faltan SUPABASE_URL / SUPABASE_SERVICE_KEY (correr desde apps/api)'); process.exit(1); }
const H = { apikey: CLAVE, Authorization: `Bearer ${CLAVE}` };

// PostgREST corta en 1.000 filas: siempre paginado y con orden estable (el 16/9 un
// orden inestable inventó cambios que no existían)
async function todo(tabla, select, filtros = '', orden = 'id') {
  const filas = [];
  for (let desde = 0; ; desde += 1000) {
    const r = await fetch(`${URL_DB}/rest/v1/${tabla}?select=${encodeURIComponent(select)}${filtros}&order=${orden}.asc&limit=1000&offset=${desde}`, { headers: H });
    if (!r.ok) throw new Error(`${tabla}: ${r.status} ${await r.text()}`);
    const lote = await r.json(); filas.push(...lote);
    if (lote.length < 1000) return filas;
  }
}

// ---------------------------------------------------------------- planillas
// Una planilla es un reporte paginado: encabezado con 'Codigo' y renglones con el
// código en la primera columna. Se aceptan el .xls original o el .json crudo
// (lista de filas con [columna, valor]) para no volver a leer el .xls, que tarda.
function filasCrudas(ruta) {
  if (ruta.endsWith('.json')) return JSON.parse(readFileSync(ruta, 'utf8')).map((r) => Object.fromEntries(r));
  const wb = XLSX.readFile(ruta);
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null, raw: true })
    .map((r) => Object.fromEntries(r.map((v, i) => [i, v]).filter(([, v]) => v != null && String(v).trim() !== '')));
}
function leerPlanilla(ruta, columnas) {
  const filas = filasCrudas(ruta);
  const enc = filas.find((f) => Object.values(f).some((v) => String(v).trim() === 'Codigo'));
  if (!enc) throw new Error(`${ruta}: no encuentro el encabezado 'Codigo'`);
  const col = {};
  for (const [nombre, titulo] of Object.entries(columnas)) {
    const hit = Object.entries(enc).find(([, v]) => String(v).trim() === titulo);
    if (!hit) throw new Error(`${ruta}: no encuentro la columna '${titulo}'`);
    col[nombre] = Number(hit[0]);
  }
  const datos = [];
  for (const f of filas) {
    const codigo = String(f[col.codigo] ?? '').trim();
    if (!/^\d+$/.test(codigo)) continue;                  // encabezados repetidos, pies de página
    // la descripción no siempre cae bajo su título: es el primer texto del renglón
    const descripcion = Object.entries(f).filter(([i, v]) => Number(i) !== col.codigo && typeof v === 'string' && /[a-z]/i.test(v))
      .map(([, v]) => v.trim())[0] ?? '';
    const r = { codigo, descripcion };
    for (const n of Object.keys(col)) if (n !== 'codigo') r[n] = f[col[n]];
    datos.push(r);
  }
  return datos;
}

// ---------------------------------------------------------------- nombres
const normal = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/\[fusionado en[^\]]*\]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
function parecido(a, b) {
  const A = new Set(normal(a).split(' ').filter((w) => w.length > 2)), B = new Set(normal(b).split(' ').filter((w) => w.length > 2));
  if (!A.size || !B.size) return normal(a) === normal(b) ? 1 : 0;
  let comun = 0; for (const w of A) if (B.has(w)) comun++;
  return comun / Math.min(A.size, B.size);
}

// ---------------------------------------------------------------- principal
const pesos = (n) => n == null ? '' : Math.round(n * 100) / 100;
const precios = leerPlanilla(RUTA_PRECIOS, { codigo: 'Codigo', precio1: 'Precio 1', precio2: 'Precio 2' });
const stock = leerPlanilla(RUTA_STOCK, { codigo: 'Codigo', rubro: 'Rubro', cantidad: 'Pack' });
console.log(`planillas: ${precios.length} renglones de precios, ${stock.length} de stock`);

const [productos, listas, filasStock] = await Promise.all([
  todo('productos', 'id,sku,codigo_legacy,nombre,activo,costo,vendido_por_peso', '&codigo_legacy=not.is.null'),
  todo('listas_precios', 'id,nombre'),
  todo('stock', 'producto_id,cantidad', `&sucursal_id=eq.${SUC_ST}`, 'producto_id'),
]);
const minorista = listas.find((l) => l.nombre === 'Minorista');
if (!minorista) throw new Error('no encuentro la lista Minorista');
const filasPrecio = await todo('precios', 'id,producto_id,precio,vigente_desde', `&lista_id=eq.${minorista.id}`);
console.log(`base: ${productos.length} productos con código del sistema viejo, ${filasPrecio.length} vigencias Minorista, ${filasStock.length} renglones de stock en ST`);

const porCodigo = new Map(productos.map((p) => [String(p.codigo_legacy).trim(), p]));
// precio vigente = la vigencia más reciente (desempate por id, el más nuevo)
const vigente = new Map();
for (const f of filasPrecio) {
  const v = vigente.get(f.producto_id);
  if (!v || f.vigente_desde > v.vigente_desde || (f.vigente_desde === v.vigente_desde && f.id > v.id)) vigente.set(f.producto_id, f);
}
const stockActual = new Map(filasStock.map((s) => [s.producto_id, Number(s.cantidad)]));

// los códigos repetidos en la planilla se resuelven por nombre, nunca por el orden
function resolver(renglones) {
  const grupos = new Map();
  for (const r of renglones) (grupos.get(r.codigo) ?? grupos.set(r.codigo, []).get(r.codigo)).push(r);
  const out = [];
  for (const [codigo, rs] of grupos) {
    const p = porCodigo.get(codigo);
    if (!p) { out.push({ codigo, r: rs[0], p: null, estado: 'sin_producto', repetido: rs.length > 1 }); continue; }
    let r = rs[0], rep = false;
    if (rs.length > 1) {
      rep = true;
      const conNombre = rs.map((x) => ({ x, s: parecido(x.descripcion, p.nombre) })).sort((a, b) => b.s - a.s);
      r = conNombre[0].s >= 0.5 && (conNombre.length < 2 || conNombre[1].s < 0.5) ? conNombre[0].x : null;
      if (!r) { out.push({ codigo, r: rs[0], p, estado: 'repetido_ambiguo', repetido: true, todos: rs }); continue; }
    }
    const sim = parecido(r.descripcion, p.nombre);
    if (!p.activo) out.push({ codigo, r, p, estado: 'inactivo', repetido: rep, sim });
    else if (sim < PARECIDO_MIN) out.push({ codigo, r, p, estado: 'nombre_distinto', repetido: rep, sim });
    else out.push({ codigo, r, p, estado: 'ok', repetido: rep, sim });
  }
  return out;
}

// ---- precios
const plan = { generado: new Date().toISOString(), lista_id: minorista.id, sucursal_id: SUC_ST, precios: [], stock: [] };
const hojaPrecios = [], hojaRevisar = [], hojaAltas = [], hojaStock = [];
const cuenta = { precio_igual: 0, precio_cambia: 0, precio_revisar: 0, stock_igual: 0, stock_ajusta: 0, stock_revisar: 0 };
for (const x of resolver(precios)) {
  const nuevo = Number(x.r.precio1);
  if (x.estado === 'sin_producto') { hojaAltas.push({ codigo: x.codigo, descripcion: x.r.descripcion, precio: nuevo, stock_st: null }); continue; }
  const actual = vigente.get(x.p.id)?.precio != null ? Number(vigente.get(x.p.id).precio) : null;
  const base = { codigo: x.codigo, sku: x.p.sku, nombre_odb: x.p.nombre, nombre_planilla: x.r.descripcion, antes: pesos(actual), ahora: pesos(nuevo), variacion: actual ? `${Math.round((nuevo / actual - 1) * 1000) / 10}%` : 'sin precio', costo: pesos(Number(x.p.costo) || null) };
  if (x.estado !== 'ok') { hojaRevisar.push({ tipo: 'precio', motivo: { inactivo: 'producto dado de baja en ODB', nombre_distinto: 'el código es otro producto en ODB', repetido_ambiguo: 'código repetido en el sistema viejo' }[x.estado], ...base }); cuenta.precio_revisar++; continue; }
  if (actual != null && Math.abs(nuevo - actual) < 0.01) { cuenta.precio_igual++; continue; }
  let motivo = null;
  if (!(nuevo >= PISO_PRECIO)) motivo = nuevo < 1 ? 'precio marcador del sistema viejo (0 o 0,01)' : `precio menor a $${PISO_PRECIO}`;
  else if (actual && Math.abs(nuevo / actual - 1) > SALTO_MAX) motivo = `salto de más de ±${SALTO_MAX * 100}%`;
  if (motivo) { hojaRevisar.push({ tipo: 'precio', motivo, ...base }); cuenta.precio_revisar++; continue; }
  hojaPrecios.push({ ...base, debajo_del_costo: Number(x.p.costo) > 0 && nuevo < Number(x.p.costo) ? 'sí' : '' });
  plan.precios.push({ producto_id: x.p.id, codigo: x.codigo, antes: actual, precio: nuevo });
  cuenta.precio_cambia++;
}

// ---- stock (Saint Thomas)
const enPlanilla = new Set();
for (const x of resolver(stock)) {
  enPlanilla.add(x.codigo);
  const viejo = Number(x.r.cantidad);
  if (x.estado === 'sin_producto') { const a = hojaAltas.find((h) => h.codigo === x.codigo); if (a) a.stock_st = viejo; else hojaAltas.push({ codigo: x.codigo, descripcion: x.r.descripcion, precio: null, stock_st: viejo }); continue; }
  const actual = stockActual.get(x.p.id) ?? 0;
  const objetivo = viejo < 0 ? 0 : viejo;               // ODB no admite stock negativo
  const base = { codigo: x.codigo, sku: x.p.sku, nombre_odb: x.p.nombre, nombre_planilla: x.r.descripcion, rubro: x.r.rubro ?? '', antes: pesos(actual), sistema_viejo: pesos(viejo), ahora: pesos(objetivo) };
  if (x.estado !== 'ok') {
    if (x.estado === 'inactivo' && Math.abs(objetivo - actual) < 0.0005) continue;
    hojaRevisar.push({ tipo: 'stock', motivo: { inactivo: 'producto dado de baja en ODB', nombre_distinto: 'el código es otro producto en ODB', repetido_ambiguo: 'código repetido en el sistema viejo' }[x.estado], ...base });
    cuenta.stock_revisar++; continue;
  }
  const delta = Math.round((objetivo - actual) * 1000) / 1000;
  if (Math.abs(delta) < 0.0005) { cuenta.stock_igual++; continue; }
  hojaStock.push({ ...base, diferencia: delta, nota: viejo < 0 ? 'negativo en el sistema viejo: queda en 0' : '' });
  plan.stock.push({ producto_id: x.p.id, codigo: x.codigo, antes: actual, objetivo, delta });
  cuenta.stock_ajusta++;
}
// lo que ODB tiene con stock en ST y la planilla no trae: no se toca, se informa
const fuera = productos.filter((p) => p.activo && !enPlanilla.has(String(p.codigo_legacy)) && (stockActual.get(p.id) ?? 0) !== 0)
  .map((p) => ({ codigo: p.codigo_legacy, sku: p.sku, nombre_odb: p.nombre, stock_st: stockActual.get(p.id) }));

// ---------------------------------------------------------------- informe
mkdirSync(SALIDA, { recursive: true });
const wb = XLSX.utils.book_new();
const hoja = (nombre, filas) => XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filas.length ? filas : [{ '(vacío)': '' }]), nombre);
const subeSt = plan.stock.filter((s) => s.delta > 0), bajaSt = plan.stock.filter((s) => s.delta < 0);
const resumen = [
  { concepto: 'Precios que cambian (se aplican)', cantidad: cuenta.precio_cambia },
  { concepto: '  · suben', cantidad: plan.precios.filter((p) => p.antes != null && p.precio > p.antes).length },
  { concepto: '  · bajan', cantidad: plan.precios.filter((p) => p.antes != null && p.precio < p.antes).length },
  { concepto: '  · no tenían precio', cantidad: plan.precios.filter((p) => p.antes == null).length },
  { concepto: 'Precios iguales (no se tocan)', cantidad: cuenta.precio_igual },
  { concepto: 'Stock que se ajusta en Saint Thomas', cantidad: cuenta.stock_ajusta },
  { concepto: '  · suben (unidades)', cantidad: `${subeSt.length} productos, +${pesos(subeSt.reduce((s, x) => s + x.delta, 0))}` },
  { concepto: '  · bajan (unidades)', cantidad: `${bajaSt.length} productos, ${pesos(bajaSt.reduce((s, x) => s + x.delta, 0))}` },
  { concepto: 'Stock igual (no se toca)', cantidad: cuenta.stock_igual },
  { concepto: 'Para revisar (NO se aplican)', cantidad: hojaRevisar.length },
  { concepto: 'Códigos que ODB no tiene (altas)', cantidad: hojaAltas.length },
  { concepto: 'Con stock en ODB y fuera de la planilla (no se tocan)', cantidad: fuera.length },
];
hoja('Resumen', resumen);
hoja('Precios que cambian', hojaPrecios.sort((a, b) => String(a.nombre_odb).localeCompare(String(b.nombre_odb))));
hoja('Stock que cambia', hojaStock.sort((a, b) => Math.abs(b.diferencia) - Math.abs(a.diferencia)));
hoja('Revisar', hojaRevisar);
hoja('Altas', hojaAltas);
hoja('Fuera de la planilla', fuera);
const xlsx = join(SALIDA, 'simulacion-sistema-viejo.xlsx');
XLSX.writeFile(wb, xlsx);
writeFileSync(join(SALIDA, 'plan.json'), JSON.stringify(plan));
console.log(JSON.stringify(resumen.map((r) => `${r.concepto}: ${r.cantidad}`), null, 1));
console.log('informe →', xlsx);
