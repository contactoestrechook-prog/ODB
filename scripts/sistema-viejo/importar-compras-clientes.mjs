// Compras de cada cliente desde el sistema viejo (24/10/2026).
//
// Para el perfil de compra de las cuentas corrientes (ticket promedio, qué
// productos compra, qué días): en NÚCLEO ninguna venta está atada a un
// cliente, pero el Crack exporta ventas.csv renglón por renglón con el
// NOMBRE del cliente. Se ata cada nombre a su ficha así:
//   1. nombre → código en clientes.csv del Crack (si el nombre es único)
//      → clientes.codigo_legacy = 'st-<código>' en NÚCLEO;
//   2. si no, nombre igual a una ficha de NÚCLEO (si es única): hay fichas de
//      Sant Thomas cargadas con códigos de otra importación («3727»).
// «Clientes Local» y «Pedidos Ya Cliente» son cuentas genéricas: no se cargan.
// Se puede correr de nuevo con un export más nuevo: borra lo de la misma
// carga (--origen) y vuelve a cargar.
//
// Uso (desde apps/api, que tiene el .env):
//   node ../../scripts/sistema-viejo/importar-compras-clientes.mjs --ventas <ventas.csv> --clientes <clientes.csv> --origen crack-st-2410 [--simular]
import { readFileSync, existsSync } from 'node:fs';

const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const SIMULAR = process.argv.includes('--simular');
const RUTA_VENTAS = arg('--ventas'), RUTA_CLIENTES = arg('--clientes'), ORIGEN = arg('--origen');
if (!RUTA_VENTAS || !RUTA_CLIENTES || !ORIGEN) { console.error('Uso: importar-compras-clientes.mjs --ventas <csv> --clientes <csv> --origen <crack-st-DDMM> [--simular]'); process.exit(1); }

const E = { ...process.env };
if (existsSync('.env')) for (const l of readFileSync('.env', 'utf8').split('\n')) { const m = /^([A-Z0-9_]+)=(.*)$/.exec(l.trim()); if (m && !E[m[1]]) E[m[1]] = m[2].replace(/^["']|["']$/g, ''); }
const URL_DB = E.SUPABASE_URL, CLAVE = E.SUPABASE_SERVICE_KEY;
if (!URL_DB || !CLAVE) { console.error('Falta SUPABASE_URL / SUPABASE_SERVICE_KEY (correr desde apps/api)'); process.exit(1); }
const H = { apikey: CLAVE, Authorization: `Bearer ${CLAVE}`, 'Content-Type': 'application/json' };

// el Crack exporta en latin-1 con punto y coma
const csv = (ruta) => new TextDecoder('latin1').decode(readFileSync(ruta)).split(/\r?\n/).filter(Boolean).slice(1).map((l) => l.split(';'));
const normal = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
const GENERICOS = new Set(['clientes local', 'pedidos ya cliente']);
// «24/10/2025» → «2025-10-24»
const fechaIso = (f) => { const [d, m, a] = f.split('/').map(Number); return `${a}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`; };

async function todo(tabla, select, filtros = '') {
  const out = [];
  for (let d = 0; ; d += 1000) {
    const r = await fetch(`${URL_DB}/rest/v1/${tabla}?select=${encodeURIComponent(select)}${filtros}&order=id.asc&limit=1000&offset=${d}`, { headers: H });
    if (!r.ok) throw new Error(`${tabla}: ${r.status} ${await r.text()}`);
    const l = await r.json(); out.push(...l); if (l.length < 1000) return out;
  }
}

// 1. nombres del Crack → código (solo los nombres que no se repiten)
const codigosPorNombre = new Map();
for (const r of csv(RUTA_CLIENTES)) {
  if (r.length < 2) continue;
  const n = normal(r[1]);
  codigosPorNombre.set(n, codigosPorNombre.has(n) ? null : r[0].trim());
}
// 2. fichas de NÚCLEO
const fichas = await todo('clientes', 'id,codigo_legacy,nombre,razon_social');
const porCodigo = new Map(fichas.filter((f) => f.codigo_legacy).map((f) => [f.codigo_legacy, f.id]));
const porNombre = new Map();
for (const f of fichas) for (const n of new Set([normal(f.nombre), normal(f.razon_social)].filter(Boolean))) porNombre.set(n, porNombre.has(n) ? null : f.id);

const clienteDe = new Map();
const sinFicha = new Map();
const filas = [];
let genericos = 0;
for (const r of csv(RUTA_VENTAS)) {
  if (r.length < 8) continue;
  const [fecha, sucursal, ticket, codigo, cantidad, precio, medio, cliente] = r;
  const n = normal(cliente);
  if (!n || GENERICOS.has(n)) { genericos++; continue; }
  if (!clienteDe.has(n)) {
    const cod = codigosPorNombre.get(n);
    clienteDe.set(n, (cod && porCodigo.get(`st-${cod}`)) || porNombre.get(n) || null);
  }
  const id = clienteDe.get(n);
  if (!id) { sinFicha.set(cliente.trim(), (sinFicha.get(cliente.trim()) ?? 0) + 1); continue; }
  filas.push({
    cliente_id: id,
    fecha: fechaIso(fecha),
    sucursal: /thomas/i.test(sucursal) ? 'st' : /in[eé]s/i.test(sucursal) ? 'si' : null,
    ticket: ticket.trim(),
    codigo_producto: codigo.trim() || null,
    cantidad: Number(String(cantidad).replace(',', '.')) || 0,
    precio_unitario: Number(String(precio).replace(',', '.')) || 0,
    medio_pago: medio.trim() || null,
    origen: ORIGEN,
  });
}

const clientes = new Set(filas.map((f) => f.cliente_id));
const tickets = new Set(filas.map((f) => `${f.cliente_id}|${f.ticket}`));
console.log(`Renglones con cliente: ${filas.length} (${tickets.size} tickets, ${clientes.size} clientes). Genéricos salteados: ${genericos}.`);
console.log(`Nombres sin ficha en NÚCLEO: ${sinFicha.size} (${[...sinFicha.values()].reduce((a, b) => a + b, 0)} renglones). Los que más compran:`);
for (const [n, c] of [...sinFicha].sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`  ${c}\t${n}`);
if (SIMULAR) { console.log('Simulación: no se cargó nada.'); process.exit(0); }

// la misma carga, de nuevo: se reemplaza entera
const del = await fetch(`${URL_DB}/rest/v1/compras_cliente_historico?origen=eq.${encodeURIComponent(ORIGEN)}`, { method: 'DELETE', headers: H });
if (!del.ok) throw new Error(`borrar la carga anterior: ${del.status} ${await del.text()}`);
for (let i = 0; i < filas.length; i += 1000) {
  const r = await fetch(`${URL_DB}/rest/v1/compras_cliente_historico`, { method: 'POST', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify(filas.slice(i, i + 1000)) });
  if (!r.ok) throw new Error(`cargar renglones ${i}–${i + 1000}: ${r.status} ${await r.text()}`);
}
console.log(`Cargado: ${filas.length} renglones con origen «${ORIGEN}».`);
