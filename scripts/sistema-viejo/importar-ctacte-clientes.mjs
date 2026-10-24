// Movimientos de cuenta corriente de cada cliente desde el sistema viejo
// (24/10/2026), para los días de deuda (deuda_antiguedad()).
//
// ctacte_clientes.csv del Crack: código del cliente, fecha, tipo (VENTA,
// PAGO, NOTA DE CREDITO, AJUSTE), comprobante, importe y el saldo que dejó.
// Cada código se ata a su ficha: clientes.codigo_legacy = 'st-<código>' o, si
// no, el nombre del Crack (clientes.csv) igual a una ficha única de NÚCLEO.
// Se puede correr de nuevo con un export más nuevo: reemplaza la misma carga.
//
// Uso (desde apps/api, que tiene el .env):
//   node ../../scripts/sistema-viejo/importar-ctacte-clientes.mjs --ctacte <ctacte_clientes.csv> --clientes <clientes.csv> --origen crack-st-2410 [--simular]
import { readFileSync, existsSync } from 'node:fs';

const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const SIMULAR = process.argv.includes('--simular');
const RUTA_CTACTE = arg('--ctacte'), RUTA_CLIENTES = arg('--clientes'), ORIGEN = arg('--origen');
if (!RUTA_CTACTE || !RUTA_CLIENTES || !ORIGEN) { console.error('Uso: importar-ctacte-clientes.mjs --ctacte <csv> --clientes <csv> --origen <crack-st-DDMM> [--simular]'); process.exit(1); }

const E = { ...process.env };
if (existsSync('.env')) for (const l of readFileSync('.env', 'utf8').split('\n')) { const m = /^([A-Z0-9_]+)=(.*)$/.exec(l.trim()); if (m && !E[m[1]]) E[m[1]] = m[2].replace(/^["']|["']$/g, ''); }
const URL_DB = E.SUPABASE_URL, CLAVE = E.SUPABASE_SERVICE_KEY;
if (!URL_DB || !CLAVE) { console.error('Falta SUPABASE_URL / SUPABASE_SERVICE_KEY (correr desde apps/api)'); process.exit(1); }
const H = { apikey: CLAVE, Authorization: `Bearer ${CLAVE}`, 'Content-Type': 'application/json' };

const csv = (ruta) => new TextDecoder('latin1').decode(readFileSync(ruta)).split(/\r?\n/).filter(Boolean).slice(1).map((l) => l.split(';'));
const normal = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
const fechaIso = (f) => { const [d, m, a] = f.split('/').map(Number); return `${a}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`; };
const numero = (x) => Number(String(x ?? '').replace(',', '.')) || 0;

async function todo(tabla, select) {
  const out = [];
  for (let d = 0; ; d += 1000) {
    const r = await fetch(`${URL_DB}/rest/v1/${tabla}?select=${encodeURIComponent(select)}&order=id.asc&limit=1000&offset=${d}`, { headers: H });
    if (!r.ok) throw new Error(`${tabla}: ${r.status} ${await r.text()}`);
    const l = await r.json(); out.push(...l); if (l.length < 1000) return out;
  }
}

const nombreCrack = new Map(csv(RUTA_CLIENTES).filter((r) => r.length > 1).map((r) => [r[0].trim(), r[1]]));
const fichas = await todo('clientes', 'id,codigo_legacy,nombre,razon_social');
const porCodigo = new Map(fichas.filter((f) => f.codigo_legacy).map((f) => [f.codigo_legacy, f.id]));
const porNombre = new Map();
for (const f of fichas) for (const n of new Set([normal(f.nombre), normal(f.razon_social)].filter(Boolean))) porNombre.set(n, porNombre.has(n) ? null : f.id);

const fichaDe = new Map();
const sinFicha = new Map();
const filas = [];
for (const r of csv(RUTA_CTACTE)) {
  if (r.length < 6) continue;
  const [codigo, fecha, tipo, comprobante, importe, saldo] = r.map((x) => x.trim());
  if (!fichaDe.has(codigo)) fichaDe.set(codigo, porCodigo.get(`st-${codigo}`) || porNombre.get(normal(nombreCrack.get(codigo))) || null);
  const id = fichaDe.get(codigo);
  if (!id) { sinFicha.set(codigo, (sinFicha.get(codigo) ?? 0) + 1); continue; }
  filas.push({ cliente_id: id, fecha: fechaIso(fecha), tipo, comprobante: comprobante || null, importe: numero(importe), saldo: saldo === '' ? null : numero(saldo), origen: ORIGEN });
}

console.log(`Movimientos con ficha: ${filas.length} de ${new Set(filas.map((f) => f.cliente_id)).size} clientes. Códigos sin ficha: ${sinFicha.size} (${[...sinFicha.values()].reduce((a, b) => a + b, 0)} movimientos).`);
if (SIMULAR) { console.log('Simulación: no se cargó nada.'); process.exit(0); }

const del = await fetch(`${URL_DB}/rest/v1/cta_cte_movimientos_crack?origen=eq.${encodeURIComponent(ORIGEN)}`, { method: 'DELETE', headers: H });
if (!del.ok) throw new Error(`borrar la carga anterior: ${del.status} ${await del.text()}`);
for (let i = 0; i < filas.length; i += 1000) {
  const r = await fetch(`${URL_DB}/rest/v1/cta_cte_movimientos_crack`, { method: 'POST', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify(filas.slice(i, i + 1000)) });
  if (!r.ok) throw new Error(`cargar ${i}–${i + 1000}: ${r.status} ${await r.text()}`);
}
console.log(`Cargado: ${filas.length} movimientos con origen «${ORIGEN}».`);
