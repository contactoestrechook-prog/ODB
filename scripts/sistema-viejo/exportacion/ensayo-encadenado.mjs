#!/usr/bin/env node
// Ensayo ENCADENADO: todas las entidades en orden dentro de UN solo bloque que
// termina con RAISE (no queda nada escrito). Sirve para ver lo que un ensayo
// suelto no puede: que las altas de artículos reciben códigos de barras, costo,
// historial y stock, que los proveedores nuevos reciben sus costos y que los
// clientes nuevos reciben su saldo inicial. Para que entre en la consola SQL usa
// una muestra: unas altas de artículos (--articulos, o las primeras N con stock,
// ventas y códigos), TODOS los saldos de cuenta corriente con sus clientes, los
// proveedores que esos costos necesitan y N renglones del resto.
// Uso (desde apps/api): node ../../scripts/sistema-viejo/exportacion/ensayo-encadenado.mjs <dir de la simulación> <usuario_id> <salida.sql> [--n 20] [--articulos a,b]
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fueraDelRepo, ENTIDADES } from './base.mjs';
import { armarCarga, sqlDeEnsayo, sqlEncadenado } from './carga.mjs';

const [DIR, USUARIO, SALIDA] = process.argv.slice(2);
const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
if (!DIR || !/^[0-9a-f-]{36}$/.test(USUARIO ?? '') || !SALIDA) { console.error('Uso: ensayo-encadenado.mjs <dir de la simulación> <usuario_id> <salida.sql> [--n 20] [--articulos a,b]'); process.exit(1); }
fueraDelRepo(DIR, 'el directorio de la simulación'); fueraDelRepo(SALIDA, 'la salida');
const N = Number(arg('--n') ?? 20);
const planes = Object.fromEntries(ENTIDADES.map((e) => [e, JSON.parse(readFileSync(join(DIR, `plan-${e}.json`), 'utf8'))]));

// altas de artículos que tocan todo: con código de barras, costo, ventas y stock
const altas = planes.articulos.secciones.altas.map((a) => a[0]);
const en = (e, s, i = 0) => new Set((planes[e].secciones[s] ?? []).map((f) => String(f[i])));
const conBarra = en('barras', 'agregar', 1), conCosto = en('costos', 'costos'), conStock = en('stock', 'ajustes'), conVenta = en('historial', 'filas');
const elegidos = new Set((arg('--articulos') ?? '').split(',').filter(Boolean));
for (const c of altas) if (elegidos.size < 8 && conBarra.has(c) && conCosto.has(c) && conStock.has(c) && conVenta.has(c)) elegidos.add(c);
for (const v of planes.articulos.secciones.vincular) elegidos.add(String(v[1]));
// clientes: los que tienen saldo inicial (todos) más unos vinculados
const saldos = planes.ctacte.secciones.saldos;
const clientesSaldo = new Set(saldos.map((s) => String(s[1])));
// proveedores que necesitan los costos de la muestra
const costosMuestra = planes.costos.secciones.costos.filter((c, i) => elegidos.has(String(c[0])) || i % Math.max(1, Math.floor(planes.costos.secciones.costos.length / N)) === 0);
const razones = new Set(costosMuestra.map((c) => c[5]).filter(Boolean));

const filtros = {
  proveedores: (s, f) => s === 'completar' || razones.has(f[0]),
  articulos: (s, f) => s === 'vincular' || elegidos.has(String(f[0])),
  precios: (s, f) => elegidos.has(String(f[0])),
  costos: (s, f) => costosMuestra.includes(f),
  barras: (s, f) => elegidos.has(String(f[1])),
  clientes: (s, f) => (s === 'altas' || s === 'vincular') && clientesSaldo.has(String(s === 'altas' ? f[0] : f[1])),
  ctacte: (s) => s === 'saldos',
  historial: (s, f) => s === 'filas' && elegidos.has(String(f[0])),
  stock: (s, f) => elegidos.has(String(f[0])),
};
const muestras = { proveedores: 0, articulos: N, precios: N, costos: 5, barras: N, clientes: N, ctacte: N, historial: N, stock: N };
const partes = [], resumen = {};
for (const e of ENTIDADES) {
  const { carga } = armarCarga(planes[e], { usuario: USUARIO, muestra: muestras[e], filtro: filtros[e], incluir: new Set(Object.keys(planes[e].pendientes ?? {})) });
  resumen[e] = Object.fromEntries(Object.entries(carga.secciones).map(([s, f]) => [s, f.length]));
  partes.push({ entidad: e, sql: sqlDeEnsayo(e, carga).sql });
}
const sql = sqlEncadenado(partes);
writeFileSync(SALIDA, sql);
console.log(JSON.stringify({ articulos_elegidos: [...elegidos], secciones: resumen }, null, 1));
console.log(`ensayo encadenado → ${SALIDA} (${(sql.length / 1024).toFixed(1)} KB)`);
