// Conexión a la base para los scripts de la exportación. simular.mjs SOLO LEE
// (GET paginados); la única escritura es la fila de auditoria de preparar.mjs y
// todo lo demás va por aplicar/<entidad>.sql, en una sola transacción.
// Se corre desde apps/api, que tiene el .env con SUPABASE_URL y SUPABASE_SERVICE_KEY.
import { readFileSync, existsSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

export const AQUI = dirname(fileURLToPath(import.meta.url));
export const REPO = realpathSync(resolve(AQUI, '../../..'));
export const SUC_ST = '229906e6-df69-48eb-b027-2b57fefb89fe';   // Suc Sant Thomas
// La referencia sale del corte de CADA exportación ('export-DDMM', en hora
// argentina): la del 21/10 12:08 es 'export-2110' y la del día del cambio tendrá
// otra. Antes era una constante y la exportación definitiva habría salido con la
// misma referencia, el mismo origen en ventas_historicas y el mismo motivo de stock.
// Todo lo que este circuito carga empieza con PREFIJO_REFERENCIA: así se reconoce
// lo de una exportación anterior (costos_historial.origen, ventas_historicas.origen).
export const PREFIJO_REFERENCIA = 'export-';
export function referenciaDe(corte) {
  const d = new Date(corte);
  if (!corte || Number.isNaN(d.getTime())) throw new Error(`corte ilegible: ${corte}`);
  const [dia, mes] = d.toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit' }).split('/');
  return `${PREFIJO_REFERENCIA}${dia}${mes}`;
}
export const ENTIDADES = ['proveedores', 'articulos', 'precios', 'costos', 'barras', 'clientes', 'ctacte', 'historial', 'stock'];

export function env() {
  const e = { ...process.env };
  if (existsSync('.env')) for (const l of readFileSync('.env', 'utf8').split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(l.trim()); if (m && !e[m[1]]) e[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return e;
}

export function conexion() {
  const E = env();
  if (!E.SUPABASE_URL || !E.SUPABASE_SERVICE_KEY) { console.error('Faltan SUPABASE_URL / SUPABASE_SERVICE_KEY (correr desde apps/api)'); process.exit(1); }
  const H = { apikey: E.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${E.SUPABASE_SERVICE_KEY}` };
  // PostgREST corta en 1.000 filas: siempre paginado y con orden estable (el 16/9
  // un orden inestable inventó cambios que no existían)
  async function todo(tabla, select, filtros = '', orden = 'id.asc') {
    const filas = [];
    for (let desde = 0; ; desde += 1000) {
      const r = await fetch(`${E.SUPABASE_URL}/rest/v1/${tabla}?select=${encodeURIComponent(select)}${filtros}&order=${orden}&limit=1000&offset=${desde}`, { headers: H });
      if (!r.ok) throw new Error(`${tabla}: ${r.status} ${await r.text()}`);
      const lote = await r.json(); filas.push(...lote);
      if (lote.length < 1000) return filas;
    }
  }
  return { E, H, todo, url: E.SUPABASE_URL };
}

// xlsx: el de scripts/importar-excel o el de apps/api (las copias de trabajo
// comparten los node_modules de apps/api)
export function xlsx() {
  const require = createRequire(import.meta.url);
  for (const d of [join(AQUI, '../../importar-excel/node_modules/xlsx'), join(REPO, 'apps/api/node_modules/xlsx')]) {
    try { return require(d); } catch { /* el siguiente */ }
  }
  throw new Error('no encuentro el paquete xlsx (npm i en apps/api)');
}

// El plan, el informe y la exportación tienen datos de clientes: nunca dentro del repo.
// (con la ruta real: en macOS /tmp es /private/tmp)
const real = (ruta) => { const r = resolve(ruta); return existsSync(r) ? realpathSync(r) : join(real(dirname(r)), basename(r)); };
export function fueraDelRepo(ruta, que) {
  const r = real(ruta);
  if (r === REPO || r.startsWith(REPO + '/')) { console.error(`${que} (${ruta}) está dentro del repo: tiene que ir afuera (trae datos de clientes y no se commitea)`); process.exit(1); }
  return r;
}
