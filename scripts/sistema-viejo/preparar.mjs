#!/usr/bin/env node
// Paso 2 de la actualización desde el sistema viejo: arma la carga y la deja
// guardada en UNA fila de auditoria (accion 'importacion_sistema_viejo'). Esa fila
// es a la vez el registro de lo que se hizo y lo que lee aplicar.sql, que aplica
// todo en una sola transacción (o nada).
//   - altas: los códigos que ODB no tiene. Antes de crear, se buscan productos de
//     ODB SIN código del sistema viejo con el mismo nombre: esos se VINCULAN (si hay
//     varios, el que tiene stock) para no duplicar.
//   - categoría: el rubro de la planilla contra categorias.nombre (sin mayúsculas;
//     si hay dos iguales, la que más productos tiene).
//   - alcohol: por el rubro (vinos, espumantes, aperitivos, cervezas, destilados).
// Uso (desde apps/api): node ../../scripts/sistema-viejo/preparar.mjs <plan.json> <referencia> <usuario_id>
import { readFileSync, existsSync } from 'node:fs';

const [RUTA_PLAN, REFERENCIA, USUARIO] = process.argv.slice(2);
if (!RUTA_PLAN || !REFERENCIA || !USUARIO) { console.error('Uso: preparar.mjs <plan.json> <referencia, ej. st-0110> <usuario_id>'); process.exit(1); }
const E = { ...process.env };
if (existsSync('.env')) for (const l of readFileSync('.env', 'utf8').split('\n')) { const m = /^([A-Z0-9_]+)=(.*)$/.exec(l.trim()); if (m && !E[m[1]]) E[m[1]] = m[2].replace(/^["']|["']$/g, ''); }
const URL_DB = E.SUPABASE_URL, CLAVE = E.SUPABASE_SERVICE_KEY;
const H = { apikey: CLAVE, Authorization: `Bearer ${CLAVE}`, 'Content-Type': 'application/json' };
async function todo(tabla, select, filtros = '') {
  const out = [];
  for (let d = 0; ; d += 1000) {
    const r = await fetch(`${URL_DB}/rest/v1/${tabla}?select=${encodeURIComponent(select)}${filtros}&order=id.asc&limit=1000&offset=${d}`, { headers: H });
    if (!r.ok) throw new Error(`${tabla}: ${r.status} ${await r.text()}`);
    const l = await r.json(); out.push(...l); if (l.length < 1000) return out;
  }
}
const normal = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const palabras = (s) => new Set(normal(s).split(' ').filter((w) => w.length > 2 && !/^x?\d+(gr?|g|cc|ml|un)?$/.test(w)));
function parecido(a, b) { const A = palabras(a), B = palabras(b); if (!A.size || !B.size) return 0; let c = 0; for (const w of A) if (B.has(w)) c++; return c / Math.max(A.size, B.size); }

const plan = JSON.parse(readFileSync(RUTA_PLAN, 'utf8'));
const [categorias, productos, sinCodigo] = await Promise.all([
  todo('categorias', 'id,nombre'),
  todo('productos', 'id,categoria_id', '&activo=eq.true'),
  todo('productos', 'id,sku,nombre', '&activo=eq.true&codigo_legacy=is.null'),
]);
const stockSt = new Map((await (async () => {
  const out = [];
  for (let d = 0; ; d += 1000) { const r = await fetch(`${URL_DB}/rest/v1/stock?select=producto_id,cantidad&sucursal_id=eq.${plan.sucursal_id}&order=producto_id.asc&limit=1000&offset=${d}`, { headers: H }); const l = await r.json(); out.push(...l); if (l.length < 1000) return out; }
})()).map((s) => [s.producto_id, Number(s.cantidad)]));
const usos = new Map(); for (const p of productos) usos.set(p.categoria_id, (usos.get(p.categoria_id) ?? 0) + 1);
const categoriaDe = (rubro) => categorias.filter((c) => normal(c.nombre) === normal(rubro)).sort((a, b) => (usos.get(b.id) ?? 0) - (usos.get(a.id) ?? 0))[0] ?? null;
const ALCOHOL = /^(vinos?|espumantes?|aperitivos?|cervezas?|destilados?|whisk|licor|gin|vodka|ron|fernet|sidra|champ)/i;

const altas = [], vincular = [], duplicados = [], sinCategoria = [];
for (const a of plan.altas) {
  if (!(Number(a.precio) >= 100)) { console.log(`  alta salteada (sin precio válido): ${a.codigo} ${a.nombre}`); continue; }
  const candidatos = sinCodigo.map((p) => ({ p, s: parecido(a.nombre, p.nombre) })).filter((x) => x.s >= 0.75)
    .sort((x, y) => (stockSt.get(y.p.id) ?? 0) - (stockSt.get(x.p.id) ?? 0) || y.s - x.s);
  if (candidatos.length) {
    const elegido = candidatos[0].p;
    vincular.push({ producto_id: elegido.id, codigo: a.codigo, nombre_odb: elegido.nombre });
    plan.precios.push({ producto_id: elegido.id, codigo: a.codigo, antes: null, precio: Number(a.precio) });
    plan.stock.push({ producto_id: elegido.id, codigo: a.codigo, objetivo: Number(a.stock) });
    for (const otro of candidatos.slice(1)) duplicados.push(`${otro.p.sku} ${otro.p.nombre} (duplicado de ${elegido.sku})`);
    continue;
  }
  const cat = categoriaDe(a.rubro);
  if (!cat) sinCategoria.push(`${a.codigo} ${a.nombre} (rubro '${a.rubro}')`);
  altas.push({ codigo: a.codigo, nombre: a.nombre, categoria_id: cat?.id ?? null, es_alcohol: ALCOHOL.test(String(a.rubro).trim()), precio: Number(a.precio), stock: Number(a.stock) });
}

const carga = {
  t: new Date().toISOString(), referencia: REFERENCIA, usuario_id: USUARIO, lista_id: plan.lista_id, sucursal_id: plan.sucursal_id,
  precios: plan.precios.map((p) => ({ producto_id: p.producto_id, codigo: p.codigo, antes: p.antes, precio: p.precio })),
  stock: plan.stock.map((s) => ({ producto_id: s.producto_id, codigo: s.codigo, antes: s.antes ?? null, objetivo: s.objetivo })),
  altas, vincular,
};
const r = await fetch(`${URL_DB}/rest/v1/auditoria`, {
  method: 'POST', headers: { ...H, Prefer: 'return=representation' },
  body: JSON.stringify({ usuario_id: USUARIO, accion: 'importacion_sistema_viejo', entidad: 'sistema_viejo', entidad_id: REFERENCIA, datos_despues: carga }),
});
if (!r.ok) throw new Error(`auditoria: ${r.status} ${await r.text()}`);
const [fila] = await r.json();
console.log(JSON.stringify({ auditoria_id: fila.id, precios: carga.precios.length, stock: carga.stock.length, altas: altas.length, vincular: vincular.map((v) => `${v.codigo} → ${v.nombre_odb}`), duplicados, sin_categoria: sinCategoria, alcohol: altas.filter((a) => a.es_alcohol).map((a) => a.nombre) }, null, 1));
