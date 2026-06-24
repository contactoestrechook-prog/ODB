// ============================================================================
// BRIDGE legacy (MS Access) → Supabase · agente de sincronización unidireccional
//
//   copia el .mdb VIVO a un temporal (NUNCA lo abre directo) → lee lprecios/
//   repuestos/cliente → mapea (map.mjs) → compara por hash contra state.json →
//   upsert SOLO lo cambiado (productos + precios + stock + clientes) → loguea en
//   sync_runs → repite cada SYNC_INTERVAL_MIN (o una sola vez con --once).
//
// Uso (dev, contra la copia):   node sync.mjs --once
// Uso (PC de ODB, continuo):    MDB_PATH="C:\\service\\climatizacion.mdb" node sync.mjs
// Ver README.md para instalar en la PC de ODB.
// ============================================================================
import MDBReader from 'mdb-reader';
import { readFileSync, writeFileSync, copyFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { mapProductos, mapClientes, diff, PROD_HASH_FIELDS, CLI_HASH_FIELDS } from './map.mjs';

const LISTA_MINORISTA = 'f0f17a57-e55e-40a3-881d-41afeba7cb73';
const SUC_CENTRAL = '229906e6-df69-48eb-b027-2b57fefb89fe';

const MDB_PATH = process.env.MDB_PATH || '../climatizacion_copia.mdb';
const STATE_FILE = process.env.STATE_FILE || './state.json';
const INTERVAL_MIN = Number(process.env.SYNC_INTERVAL_MIN || 10);
const RUN_ONCE = process.argv.includes('--once') || process.env.RUN_ONCE === '1';

// --- env: variables del proceso o, en dev, apps/api/.env ---
function cargarEnv() {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) return process.env;
  for (const p of ['../../apps/api/.env', '../apps/api/.env']) {
    if (existsSync(p)) {
      return Object.fromEntries(
        readFileSync(p, 'utf8').split('\n').map((l) => l.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean)
          .map((m) => [m[1], m[2].replace(/^["']|["']$/g, '')]),
      );
    }
  }
  throw new Error('Faltan SUPABASE_URL y SUPABASE_SERVICE_KEY (en el entorno o en apps/api/.env)');
}
const env = cargarEnv();
const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

const chunk = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };
const norm = (s) => (s || '').toString().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
const ahora = () => new Date().toISOString().slice(11, 19);
const log = (...a) => console.log(`[${ahora()}]`, ...a);

// copia el .mdb a un temporal (con 1 reintento si está lockeado) y lo lee
function leerLegacy() {
  const tmp = join(tmpdir(), `odb-sync-${Date.now()}.mdb`);
  let copiado = false;
  for (let intento = 1; intento <= 2 && !copiado; intento++) {
    try { copyFileSync(MDB_PATH, tmp); copiado = true; }
    catch (e) { if (intento === 2) throw new Error(`No pude copiar ${MDB_PATH}: ${e.message}`); }
  }
  try {
    const r = new (MDBReader.default ?? MDBReader)(readFileSync(tmp));
    return {
      lprecios: r.getTable('lprecios').getData({ rowLimit: 1e6 }),
      repuestos: r.getTable('repuestos').getData({ rowLimit: 1e6 }),
      cliente: r.getTable('cliente').getData({ rowLimit: 1e6 }),
    };
  } finally {
    try { rmSync(tmp, { force: true }); } catch { /* noop */ }
  }
}

async function categoriaIds(rubros) {
  const { data } = await db.from('categorias').select('id,nombre');
  const byNorm = new Map((data || []).map((c) => [norm(c.nombre), c.id]));
  const faltan = [...new Set(rubros.filter(Boolean))].filter((ru) => !byNorm.has(norm(ru)));
  for (const c of chunk(faltan, 200)) {
    const { data: ins, error } = await db.from('categorias').insert(c.map((nombre) => ({ nombre }))).select('id,nombre');
    if (error) throw new Error('categorias: ' + error.message);
    ins.forEach((x) => byNorm.set(norm(x.nombre), x.id));
  }
  return byNorm;
}

async function upsertProductos(cambiados) {
  if (!cambiados.length) return 0;
  const cats = await categoriaIds(cambiados.map((p) => p.rubro));
  const catId = (ru) => (ru ? cats.get(norm(ru)) || null : null);

  for (const c of chunk(cambiados, 500)) {
    const rows = c.map((p) => ({
      sku: 'L' + p.codigo, codigo_legacy: p.codigo, nombre: p.nombre,
      categoria_id: catId(p.rubro), costo: p.costo || 0, es_alcohol: !!p.es_alcohol,
      unidades_pack: p.unidades_pack || 1, alicuota_iva: 21, activo: true,
    }));
    const { error } = await db.from('productos').upsert(rows, { onConflict: 'codigo_legacy' });
    if (error) throw new Error('productos: ' + error.message);
  }

  // map codigo_legacy → id (solo de los cambiados)
  const idByCod = new Map();
  for (const c of chunk(cambiados.map((p) => p.codigo), 800)) {
    const { data, error } = await db.from('productos').select('id,codigo_legacy').in('codigo_legacy', c);
    if (error) throw new Error('productos select: ' + error.message);
    data.forEach((p) => idByCod.set(p.codigo_legacy, p.id));
  }
  const ids = cambiados.map((p) => idByCod.get(p.codigo)).filter(Boolean);

  // precios (Minorista): reemplazo de los cambiados
  for (const c of chunk(ids, 400)) await db.from('precios').delete().eq('lista_id', LISTA_MINORISTA).in('producto_id', c);
  const precios = cambiados.filter((p) => p.precioFinal > 0 && idByCod.get(p.codigo))
    .map((p) => ({ producto_id: idByCod.get(p.codigo), lista_id: LISTA_MINORISTA, precio: p.precioFinal }));
  for (const c of chunk(precios, 500)) { const { error } = await db.from('precios').insert(c); if (error) throw new Error('precios: ' + error.message); }

  // stock (O.D.B Central): reemplazo de los cambiados (sin stock → queda sin fila = a pedido)
  for (const c of chunk(ids, 400)) await db.from('stock').delete().eq('sucursal_id', SUC_CENTRAL).in('producto_id', c);
  const stock = cambiados.filter((p) => p.stock > 0 && idByCod.get(p.codigo))
    .map((p) => ({ producto_id: idByCod.get(p.codigo), sucursal_id: SUC_CENTRAL, cantidad: p.stock, stock_minimo: p.stockmin || 0 }));
  for (const c of chunk(stock, 500)) { const { error } = await db.from('stock').insert(c); if (error) throw new Error('stock: ' + error.message); }

  return cambiados.length;
}

async function upsertClientes(cambiados) {
  let ok = 0;
  for (const c of chunk(cambiados, 500)) {
    const { error } = await db.from('clientes').upsert(c, { onConflict: 'codigo_legacy' });
    if (error) throw new Error('clientes: ' + error.message);
    ok += c.length;
  }
  return ok;
}

async function corrida() {
  const t0 = Date.now();
  const reg = { productos_leidos: 0, productos_actualizados: 0, clientes_leidos: 0, clientes_actualizados: 0, ok: true, error: null };
  try {
    const { lprecios, repuestos, cliente } = leerLegacy();
    const productos = mapProductos(lprecios, repuestos);
    const clientes = mapClientes(cliente);
    reg.productos_leidos = productos.length;
    reg.clientes_leidos = clientes.length;

    const state = existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, 'utf8')) : { productos: {}, clientes: {} };
    const dP = diff(productos, 'codigo', PROD_HASH_FIELDS, state.productos);
    const dC = diff(clientes, 'codigo_legacy', CLI_HASH_FIELDS, state.clientes);
    log(`leídos: ${productos.length} prod / ${clientes.length} cli · cambios: ${dP.changed.length} prod / ${dC.changed.length} cli`);

    reg.productos_actualizados = await upsertProductos(dP.changed);
    reg.clientes_actualizados = await upsertClientes(dC.changed);

    writeFileSync(STATE_FILE, JSON.stringify({ productos: dP.next, clientes: dC.next }));
  } catch (e) {
    reg.ok = false; reg.error = e.message;
    log('ERROR:', e.message);
  }
  const duracion_ms = Date.now() - t0;
  await db.from('sync_runs').insert({ ...reg, duracion_ms }).then(({ error }) => { if (error) log('no pude loguear sync_runs:', error.message); });
  log(`corrida ${reg.ok ? 'OK' : 'CON ERROR'} en ${duracion_ms}ms · upserts: ${reg.productos_actualizados} prod / ${reg.clientes_actualizados} cli`);
  return reg;
}

// --- main ---
log(`bridge legacy→Supabase · origen=${MDB_PATH} · ${RUN_ONCE ? 'una vez' : `cada ${INTERVAL_MIN} min`}`);
await corrida();
if (!RUN_ONCE) {
  setInterval(corrida, INTERVAL_MIN * 60 * 1000);
  log('en marcha. Ctrl+C para detener.');
}
