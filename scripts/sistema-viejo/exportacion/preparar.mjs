#!/usr/bin/env node
// Paso 2 de la carga de la exportación: arma la carga de UNA entidad a partir de
// plan-<entidad>.json (simular.mjs) y la guarda en UNA fila de auditoria (accion
// 'importacion_sistema_viejo', entidad 'sistema_viejo:<entidad>', entidad_id
// 'export-2110'). Esa fila es el registro de lo que se hizo y lo que lee
// aplicar/<entidad>.sql. Todavía no se aplica nada.
//
//   - Lo de la hoja Revisar NO entra, salvo lo que el dueño aprobó: --aprobar con
//     el informe (columna "aprobar" = sí / x en la hoja Revisar) o un .txt con una
//     clave por renglón. Solo se puede aprobar lo que tiene propuesta.
//   - Las secciones pendientes de una decisión del dueño (Mayorista, costos de más
//     de un año, quitar cajas, habilitar la cuenta corriente a los activos) entran
//     solo con --incluir.
//   - --ensayo <archivo.sql>: NO escribe nada. Deja el aplicar/<entidad>.sql listo
//     para ensayar en producción: la fila de auditoria se crea DENTRO del mismo
//     bloque, con un control md5 de la carga, y el bloque termina con RAISE (todo
//     vuelve atrás). --muestra N toma N renglones repartidos de cada sección
//     (para ensayar entidades grandes por la consola SQL) y --codigos a,b los suma.
//     --con-migracion <db/archivo.sql> corre una migración todavía no aplicada
//     dentro del mismo bloque (vuelve atrás con todo).
//
// Uso (desde apps/api):
//   node ../../scripts/sistema-viejo/exportacion/preparar.mjs <dir de la simulación> <entidad> <usuario_id del dueño>
//        [--aprobar <informe.xlsx|claves.txt>] [--incluir mayorista,...] [--ensayo <archivo.sql> [--muestra N] [--codigos a,b] [--con-migracion <db/x.sql>]]
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { conexion, xlsx, fueraDelRepo, ENTIDADES } from './base.mjs';
import { armarCarga, sqlDeEnsayo } from './carga.mjs';

const [DIR, ENTIDAD, USUARIO] = process.argv.slice(2);
const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
if (!DIR || !ENTIDADES.includes(ENTIDAD) || !/^[0-9a-f-]{36}$/.test(USUARIO ?? '')) {
  console.error(`Uso: preparar.mjs <dir de la simulación> <${ENTIDADES.join('|')}> <usuario_id> [--aprobar <archivo>] [--incluir <secciones>] [--ensayo <archivo.sql> [--muestra N] [--codigos a,b]]`);
  process.exit(1);
}
fueraDelRepo(DIR, 'el directorio de la simulación');
const ENSAYO = arg('--ensayo'), MUESTRA = Number(arg('--muestra') ?? 0);
if (ENSAYO) fueraDelRepo(ENSAYO, '--ensayo');
if (MUESTRA && !ENSAYO) { console.error('--muestra es solo para --ensayo'); process.exit(1); }
const lista = (s) => new Set((s ?? '').split(',').map((x) => x.trim()).filter(Boolean));

// aprobaciones del dueño: la hoja Revisar del informe (columna "aprobar") o un .txt
function clavesAprobadas(ruta) {
  if (!ruta) return new Set();
  if (/\.xlsx?$/i.test(ruta)) {
    const XLSX = xlsx();
    const filas = XLSX.utils.sheet_to_json(XLSX.readFile(ruta).Sheets.Revisar ?? {}, { defval: '' });
    return new Set(filas.filter((f) => /^(s[ií]|x|1|ok)$/i.test(String(f.aprobar).trim())).map((f) => String(f.clave).trim()));
  }
  return new Set(readFileSync(ruta, 'utf8').split(/\r?\n/).map((s) => s.trim()).filter(Boolean));
}

const plan = JSON.parse(readFileSync(join(DIR, `plan-${ENTIDAD}.json`), 'utf8'));
if (plan.entidad !== ENTIDAD) throw new Error(`el plan es de ${plan.entidad}, no de ${ENTIDAD}`);
const incluir = lista(arg('--incluir'));
const { carga, usadas, sinPropuesta } = armarCarga(plan, { usuario: USUARIO, incluir, aprobadas: clavesAprobadas(arg('--aprobar')), muestra: MUESTRA, codigos: lista(arg('--codigos')) });
console.log(JSON.stringify({
  entidad: ENTIDAD, secciones: Object.fromEntries(Object.entries(carga.secciones).map(([s, f]) => [s, f.length])), esperado_sin_aprobar: plan.esperado,
  aprobadas: usadas.length, aprobadas_sin_propuesta: sinPropuesta, pendientes_no_incluidas: Object.keys(plan.pendientes ?? {}).filter((s) => !incluir.has(s)),
  muestra: carga.muestra?.total ?? null,
}, null, 1));

if (ENSAYO) {
  const { sql, md5 } = sqlDeEnsayo(ENTIDAD, carga, { migracion: arg('--con-migracion') });
  writeFileSync(ENSAYO, sql);
  console.log(`ensayo → ${ENSAYO} (${(sql.length / 1024).toFixed(1)} KB, md5 de la carga ${md5}). Correrlo en la consola SQL: tiene que terminar con "ENSAYO OK" y no deja nada escrito.`);
  process.exit(0);
}

// la fila de auditoria: lo único que escribe este paso
const { E, H } = conexion();
const previas = await (await fetch(`${E.SUPABASE_URL}/rest/v1/auditoria?select=id,aplicado:datos_antes->aplicado&accion=eq.importacion_sistema_viejo&entidad=eq.sistema_viejo:${ENTIDAD}&entidad_id=eq.${carga.referencia}`, { headers: H })).json();
if (previas.length) console.log(`ojo: ya hay ${previas.length} carga(s) de ${ENTIDAD} con la referencia ${carga.referencia}: ${previas.map((p) => `${p.id}${p.aplicado ? ' (aplicada)' : ''}`).join(', ')}. Aplicar otra no duplica (cada bloque es idempotente).`);
const r = await fetch(`${E.SUPABASE_URL}/rest/v1/auditoria`, {
  method: 'POST', headers: { ...H, 'Content-Type': 'application/json', Prefer: 'return=representation' },
  body: JSON.stringify({ usuario_id: USUARIO, accion: 'importacion_sistema_viejo', entidad: `sistema_viejo:${ENTIDAD}`, entidad_id: carga.referencia, datos_despues: carga }),
});
if (!r.ok) throw new Error(`auditoria: ${r.status} ${await r.text()}`);
const [fila] = await r.json();
console.log(`carga guardada: auditoria id ${fila.id}. Ahora aplicar/${ENTIDAD}.sql con __AUDITORIA_ID__ = ${fila.id}: primero __ENSAYO__ = true, después false.`);
