// Arma la carga de una entidad (lo que va a la fila de auditoria y lee
// aplicar/<entidad>.sql) a partir de plan-<entidad>.json, y el SQL de ENSAYO con
// la carga adentro. Lo usan preparar.mjs y ensayo-encadenado.mjs.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { AQUI, referenciaDe } from './base.mjs';

// plan: el plan-<entidad>.json · incluir: secciones pendientes que el dueño decidió
// cargar · aprobadas: claves de la hoja Revisar · filtro(seccion, fila) → bool y
// muestra N (con codigos que se suman siempre): solo para ensayar.
export function armarCarga(plan, { usuario, incluir = new Set(), aprobadas = new Set(), muestra = 0, codigos = new Set(), filtro = null } = {}) {
  for (const s of incluir) if (!(s in (plan.pendientes ?? {}))) throw new Error(`--incluir ${s}: no es una sección pendiente de ${plan.entidad} (pendientes: ${Object.keys(plan.pendientes ?? {}).join(', ') || 'ninguna'})`);
  const secciones = {};
  for (const [s, filas] of Object.entries(plan.secciones)) if (!(s in (plan.pendientes ?? {})) || incluir.has(s)) secciones[s] = [...filas];
  const usadas = [], sinPropuesta = [];
  // propuestas que se excluyen (mismo `grupo`: por ejemplo «reemplazar» o «sumar»
  // un saldo suelto): aprobar dos es un error, no se elige una en silencio
  const porGrupo = new Map();
  for (const r of plan.revisar ?? []) {
    if (!aprobadas.has(r.clave) || !r.grupo) continue;
    if (porGrupo.has(r.grupo)) throw new Error(`se aprobaron dos propuestas que se excluyen: ${porGrupo.get(r.grupo)} y ${r.clave} (aprobar solo una)`);
    porGrupo.set(r.grupo, r.clave);
  }
  for (const r of plan.revisar ?? []) {
    if (!aprobadas.has(r.clave)) continue;
    if (!r.aplicar) { sinPropuesta.push(r.clave); continue; }
    for (const [s, filas] of Object.entries(r.aplicar)) (secciones[s] ??= []).push(...filas);
    usadas.push(r.clave);
  }
  let datosMuestra = null;
  if (muestra > 0 || filtro) {
    datosMuestra = { n: muestra || null, total: {} };
    for (const [s, filas] of Object.entries(secciones)) {
      datosMuestra.total[s] = filas.length;
      const elegidas = new Set();
      if (muestra > 0) { const paso = Math.max(1, filas.length / muestra); for (let i = 0; i < filas.length && elegidas.size < muestra; i += paso) elegidas.add(Math.floor(i)); }
      filas.forEach((f, i) => { if (codigos.has(String(f[0])) || codigos.has(String(f[1])) || (filtro && filtro(s, f))) elegidas.add(i); });
      secciones[s] = [...elegidas].sort((a, b) => a - b).map((i) => filas[i]);
    }
  }
  // con una muestra, los nombres de referencia del historial se recortan a los códigos que quedan
  const datos = { ...(plan.datos ?? {}) };
  if (datosMuestra && datos.nombres && secciones.filas) {
    const quedan = new Set(secciones.filas.map((f) => String(f[0])));
    datos.nombres = Object.fromEntries(Object.entries(datos.nombres).filter(([c]) => quedan.has(c)));
  }
  const carga = {
    t: new Date().toISOString(), referencia: plan.referencia ?? referenciaDe(plan.corte), entidad: plan.entidad, usuario_id: usuario, corte: plan.corte,
    plan_generado: plan.generado, formato: plan.formato, datos, secciones,
    incluidas: [...incluir], aprobadas: usadas, ...(datosMuestra ? { muestra: datosMuestra } : {}),
  };
  return { carga, usadas, sinPropuesta };
}

// El aplicar/<entidad>.sql listo para ENSAYAR: la fila de auditoria se crea dentro
// del mismo bloque (con un control md5: si la carga se copió mal, se frena) y el
// bloque termina con RAISE, así que no queda nada escrito.
const MARCAS = ['-- __CARGA_ENSAYO__', 'v_ensayo boolean := __ENSAYO__;', 'v_id bigint := __AUDITORIA_ID__;'];
// migracion: un .sql de db/ que todavía no se aplicó (por ejemplo
// db/migracion-ventas-historicas.sql) se corre DENTRO del mismo bloque, antes de
// la carga, y vuelve atrás con todo lo demás: así se ensaya la carga con la tabla
// o las columnas nuevas sin aplicar la migración.
export const sentenciasDe = (sql) => sql.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n')
  .split(/;\s*(?:\n|$)/).map((x) => x.trim()).filter(Boolean);
export function sqlDeEnsayo(entidad, carga, { migracion = null } = {}) {
  const sql = readFileSync(join(AQUI, 'aplicar', `${entidad}.sql`), 'utf8');
  for (const m of MARCAS) if (sql.split(m).length !== 2) throw new Error(`aplicar/${entidad}.sql tiene que tener una vez '${m}'`);
  const json = JSON.stringify(carga);
  if (json.includes('$carga$')) throw new Error('la carga contiene $carga$');
  const md5 = createHash('md5').update(json, 'utf8').digest('hex');
  const ddl = migracion ? sentenciasDe(readFileSync(migracion, 'utf8')).map((x) => {
    if (x.includes('$m$')) throw new Error('la migración contiene $m$');
    return `execute $m$${x}$m$;`;
  }) : [];
  const prologo = [
    ...(ddl.length ? ['-- migración sin aplicar, dentro del ensayo (vuelve atrás con todo)', ...ddl.map((x) => `  ${x}`), ''] : []),
    `${ddl.length ? '  ' : ''}v_carga_texto := $carga$${json}$carga$;`,
    `  if md5(v_carga_texto) <> '${md5}' then raise exception 'ENSAYO: la carga no llegó entera (md5 distinto)'; end if;`,
    '  insert into auditoria (usuario_id, accion, entidad, entidad_id, datos_despues)',
    `  values ('${carga.usuario_id}', 'importacion_sistema_viejo', 'sistema_viejo:${entidad}', '${carga.referencia}', v_carga_texto::jsonb) returning id into v_id;`,
  ].join('\n');
  const salida = sql.replace(MARCAS[0], prologo).replace(MARCAS[1], 'v_ensayo boolean := true;').replace(MARCAS[2], 'v_id bigint := null;');
  return { sql: salida, md5 };
}

// Varios ensayos en UN solo bloque, en orden (las altas de artículos existen
// para barras y stock; los clientes nuevos, para la cuenta corriente): cada
// entidad es un bloque anidado que anota su resultado y el bloque de afuera
// termina con RAISE. Un solo statement: o se ve "ENSAYO ENCADENADO OK" o falla,
// y en los dos casos no queda nada.
export function sqlEncadenado(partes) {
  const cuerpos = partes.map(({ entidad, sql }) => {
    const ini = sql.indexOf('do $$'), fin = sql.lastIndexOf('end $$;');
    if (ini < 0 || fin < 0) throw new Error(`${entidad}: no encuentro el bloque do $$ … end $$;`);
    const cuerpo = sql.slice(ini + 'do $$'.length, fin).trimEnd() + '\nend;';
    const fin2 = "raise exception '%', v_msg; -- __FIN_ENSAYO__";
    if (cuerpo.split(fin2).length !== 2) throw new Error(`${entidad}: falta la marca __FIN_ENSAYO__`);
    return `-- ${entidad}\n${cuerpo.replace(fin2, 'informe := informe || chr(10) || v_msg;')}`;
  });
  return `do $$\ndeclare informe text := '';\nbegin\n${cuerpos.join('\n')}\nraise exception 'ENSAYO ENCADENADO OK (nada quedó escrito):%', informe;\nend $$;\n`;
}
