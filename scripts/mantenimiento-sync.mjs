#!/usr/bin/env node
// MANTENIMIENTO: carga en la base cada trabajo publicado (Leandro, 9/11/2026:
// «van a estar conectadas a estas sesiones, que se van a actualizar de forma
// automática»). Corre solo al final de scripts/publicar.sh; también se puede
// correr a mano:
//
//   node scripts/mantenimiento-sync.mjs               los commits nuevos de origin/main
//   node scripts/mantenimiento-sync.mjs --recalcular  además rehace los minutos de todos
//
// De cada commit de main (sin merges ni autoguardados):
//   - quién lo pidió, cuándo y sus palabras salen del mensaje, tal cual
//     («(Leandro, 6/11/2026: «arriba tienen que estar los más nuevos»)»);
//   - el tipo (bug, arreglo, mejora, nuevo, propuesta), el área y el resumen
//     para el dueño salen de reglas sobre el mensaje (clasificarSinIA); si hay
//     una clave de Anthropic de MetoGroup, los escribe Claude Haiku;
//   - el tiempo se estima por las sesiones de trabajo: commits (autoguardados
//     incluidos) separados por menos de 45 minutos son una sesión, y el largo
//     de la sesión se reparte entre sus trabajos según cuánto código tocó cada
//     uno. Es una estimación y se muestra como tal.
//
// SUPABASE_URL y SUPABASE_SERVICE_KEY salen de apps/api/.env de esta copia o,
// si es una copia nueva sin .env, de ~/Projects/odb. La clave de Anthropic NO es
// la de ODB (regla del 1/10/2026: el cliente paga solo su bot; lo de
// programación sale de la de Leandro): MANTENIMIENTO_ANTHROPIC_KEY o
// ANTHROPIC_API_KEY de apps/api/.env.desarrollo. Sin ella, todo por reglas.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const RECALCULAR = process.argv.includes('--recalcular');
const LIMITE = Number(process.argv.find((a) => a.startsWith('--limite='))?.slice(9)) || Infinity; // para probar con pocos
const REF = process.argv.find((a) => !a.startsWith('-') && a !== process.argv[0] && a !== process.argv[1]) ?? 'origin/main';
const MODELO = process.env.MANTENIMIENTO_MODELO ?? 'claude-haiku-5-5';
const PAUSA_SESION = 45 * 60_000; // más que esto sin commits: otra sesión
const ARRANQUE = 15; // minutos de la sesión antes del primer commit (leer, pensar)

function cargarEnv() {
  for (const f of [join(RAIZ, 'apps/api/.env'), join(homedir(), 'Projects/odb/apps/api/.env')]) {
    if (!existsSync(f)) continue;
    const env = {};
    for (const l of readFileSync(f, 'utf8').split('\n')) {
      const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }
    if (env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY) return env;
  }
  throw new Error('No encontré SUPABASE_URL y SUPABASE_SERVICE_KEY en apps/api/.env');
}
const ENV = { ...cargarEnv(), ...process.env };
function claveMetogroup() {
  if (process.env.MANTENIMIENTO_ANTHROPIC_KEY) return process.env.MANTENIMIENTO_ANTHROPIC_KEY;
  for (const f of [join(RAIZ, 'apps/api/.env.desarrollo'), join(homedir(), 'Projects/odb/apps/api/.env.desarrollo')]) {
    if (!existsSync(f)) continue;
    const m = readFileSync(f, 'utf8').match(/^ANTHROPIC_API_KEY=(.+)$/m);
    if (m) return m[1].trim().replace(/^["']|["']$/g, '');
  }
  return null;
}
const CLAVE_IA = claveMetogroup();
const BASE = `${ENV.SUPABASE_URL}/rest/v1/mantenimiento_trabajos`;
const CAB = { apikey: ENV.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${ENV.SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json' };

const git = (...args) => execFileSync('git', ['-C', RAIZ, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

// ---- el historial ----------------------------------------------------------

function leerCommits() {
  const SEP = '\x1e', CAMPO = '\x1f';
  const crudo = git('log', REF, `--format=${SEP}%H${CAMPO}%aI${CAMPO}%P${CAMPO}%B${CAMPO}`, '--numstat');
  return crudo.split(SEP).filter(Boolean).map((bloque) => {
    const [hash, fecha, padres, mensaje, stats = ''] = bloque.split(CAMPO);
    const archivos = stats.split('\n').map((l) => l.split('\t')).filter((p) => p.length === 3);
    const lineas = archivos.reduce((s, [mas, menos]) => s + (Number(mas) || 0) + (Number(menos) || 0), 0);
    const partes = [...new Set(archivos.map(([, , ruta]) => parteDe(ruta)).filter(Boolean))];
    const esMerge = padres.trim().split(' ').length > 1;
    const autoguardado = /^Autoguardado/i.test(mensaje.trim());
    return { hash, fecha: new Date(fecha), mensaje: mensaje.trim(), archivos: archivos.length, lineas, partes, cuenta: !esMerge && !autoguardado && mensaje.trim() !== '' };
  });
}

function parteDe(ruta) {
  if (ruta.startsWith('apps/admin/')) return 'panel';
  if (ruta.startsWith('apps/api/')) return 'sistema';
  if (ruta.startsWith('apps/web/')) return 'tienda';
  if (ruta.startsWith('apps/mobile/')) return 'app';
  if (ruta.startsWith('apps/pos/')) return 'caja';
  if (ruta.startsWith('db/')) return 'base';
  if (ruta.startsWith('infra/')) return 'servidor';
  return null;
}

// Quién lo pidió, cuándo y con qué palabras, tal como lo escribimos en el commit:
// «(Leandro, 6/11/2026: «arriba…»)», «Ana, 5/11/2026», «Leandro, 5/11/2026: "…"».
export function pedidoDe(mensaje) {
  const prop = mensaje.match(/propuesta de metogroup(?:,\s*(\d{1,2})\/(\d{1,2})\/(\d{4}))?/i);
  if (prop) {
    const [, d, mes, a] = prop;
    return { pidio: 'MetoGroup', pedido_el: a ? `${a}-${mes.padStart(2, '0')}-${d.padStart(2, '0')}` : null, cita: null, propuesta: true };
  }
  const m = mensaje.match(/([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?: [A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)?),\s*(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[^:«"“\n)]*:\s*[«"“]([^»"”]+)[»"”])?/);
  if (!m) return { pidio: null, pedido_el: null, cita: null };
  const [, quien, d, mes, a, cita] = m;
  return { pidio: quien, pedido_el: `${a}-${mes.padStart(2, '0')}-${d.padStart(2, '0')}`, cita: cita?.trim() ?? null };
}

// El tiempo de cada trabajo, por sesiones (ver arriba).
export function estimarMinutos(commits) {
  const orden = [...commits].sort((a, b) => a.fecha - b.fecha);
  const minutos = new Map();
  let sesion = [];
  const cerrar = () => {
    const trabajos = sesion.filter((c) => c.cuenta);
    if (trabajos.length) {
      const largo = (sesion[sesion.length - 1].fecha - sesion[0].fecha) / 60_000 + ARRANQUE;
      const peso = (c) => Math.sqrt(c.lineas + 1);
      // el tiempo de los autoguardados de la sesión es de los trabajos que se publicaron en ella
      const total = trabajos.reduce((s, c) => s + peso(c), 0);
      for (const c of trabajos) minutos.set(c.hash, Math.max(5, Math.round((largo * peso(c)) / total)));
    }
    sesion = [];
  };
  for (const c of orden) {
    if (sesion.length && c.fecha - sesion[sesion.length - 1].fecha > PAUSA_SESION) cerrar();
    sesion.push(c);
  }
  cerrar();
  return minutos;
}

// 'AAAA-MM' en hora argentina
const mesDe = (f) => new Date(f.getTime() - 3 * 3600_000).toISOString().slice(0, 7);

// ---- la clasificación ------------------------------------------------------

const AREAS = ['Compras y facturas', 'Caja y ventas', 'Pedidos y reparto', 'Depósito y stock', 'Productos y precios', 'Clientes', 'WhatsApp y bot', 'Administración y cobros', 'Tienda web', 'App', 'Informes y estadísticas', 'Asistentes IA', 'Equipo y permisos', 'Servidor y seguridad'];

const HERRAMIENTA = {
  name: 'clasificar',
  description: 'Clasifica cada trabajo de mantenimiento del sistema de ODB.',
  input_schema: {
    type: 'object',
    properties: {
      trabajos: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            hash: { type: 'string' },
            tipo: { type: 'string', enum: ['bug', 'arreglo', 'mejora', 'nuevo', 'propuesta'] },
            area: { type: 'string', enum: AREAS },
            titulo: { type: 'string', description: 'Hasta 8 palabras, sin punto final.' },
            que_se_hizo: { type: 'string', description: 'Una o dos frases para el dueño del negocio, sin nombres de archivos ni jerga técnica.' },
            para_que: { type: 'string', description: 'Una frase: qué gana el negocio o qué deja de pasar.' },
            pidio: { type: ['string', 'null'], description: 'Quién lo pidió si el mensaje lo dice; null si no lo dice.' },
          },
          required: ['hash', 'tipo', 'area', 'titulo', 'que_se_hizo', 'para_que', 'pidio'],
        },
      },
    },
    required: ['trabajos'],
  },
};

const INSTRUCCIONES = `Sos el que arma el informe de mantenimiento del sistema de ODB Premium Market (un almacén y vinoteca con dos sucursales) que hace MetoGroup.
Te paso trabajos ya publicados (mensajes de commit). Para cada uno decidí:
- tipo:
  · bug: algo del sistema fallaba, daba error, no abría, se colgaba, perdía o duplicaba datos, o calculaba mal;
  · arreglo: algo funcionaba pero no como el negocio lo necesita y se corrigió (un dato, un permiso, un texto, una regla);
  · mejora: algo que ya existía quedó mejor (más claro, más rápido, a pantalla completa, más datos, menos pasos);
  · nuevo: una pantalla, función, módulo o integración que no existía;
  · propuesta: una mejora que se le ocurrió a MetoGroup sin que nadie de ODB la pidiera (solo si el mensaje no dice que alguien la pidió).
- area: la parte del negocio a la que le sirve.
- titulo, que_se_hizo y para_que: en castellano rioplatense, claro, para el dueño. Nada de rutas, nombres de archivos, funciones ni siglas internas.
- pidio: el nombre de quien lo pidió si el mensaje lo dice (Leandro, Ana, Juan Pablo, Anabella…); si no, null.
Clasificá todos, sin saltear ninguno, con el mismo hash que te paso.`;

async function clasificar(lote) {
  const texto = lote.map((c) => `### ${c.hash}\nPartes: ${c.partes.join(', ') || '—'}\n${c.mensaje.slice(0, 2500)}`).join('\n\n');
  for (let intento = 1; intento <= 3; intento++) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': CLAVE_IA, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODELO,
        max_tokens: 16000,
        system: INSTRUCCIONES,
        tools: [HERRAMIENTA],
        tool_choice: { type: 'tool', name: 'clasificar' },
        messages: [{ role: 'user', content: texto }],
      }),
    });
    if (res.ok) {
      const datos = await res.json();
      const uso = datos.content?.find((b) => b.type === 'tool_use');
      return new Map((uso?.input?.trabajos ?? []).map((t) => [t.hash, t]));
    }
    const error = await res.text();
    if (intento === 3 || res.status < 500 && res.status !== 429) throw new Error(`Claude respondió ${res.status}: ${error.slice(0, 300)}`);
    await new Promise((r) => setTimeout(r, 4000 * intento));
  }
}

// Sin IA: el tipo, el área y el resumen salen del mensaje. Nuestros mensajes
// ya vienen en castellano y para el dueño («Pedidos y Depósito: arriba de cada
// carril, los más nuevos»): lo de antes de los dos puntos es el título y lo de
// después, qué se hizo.
const AREAS_REGLAS = [
  ['Asistentes IA', /analista|agente ia|\bagente\b|sommelier|somelier|asistente|\bopus\b|haiku|razon(a|amiento)|esfuerzo/],
  ['WhatsApp y bot', /\bbot\b|whatsapp|responde|difusi|waha|gows|\blínea|campaña|meta\b/],
  ['Compras y facturas', /factura|lector|proveedor|compra|percepci|nota de crédito|remito|recepci|cigarrillo|internos|\biva\b|mesa de compras/],
  ['Pedidos y reparto', /pedido|reparto|repartidor|envío|entrega|salón|op salón|armad|pedidosya|retiro|carril/],
  ['Caja y ventas', /\bcaja|ticket|venta|\bpos\b|comanda|cierre de caja|cajer/],
  ['Depósito y stock', /stock|inventario|conteo|arqueo|fraccion|vencimiento|frío|qbit|depósito/],
  ['Administración y cobros', /aprobaci|mercado pago|tarjeta|cheque|conciliaci|\barca\b|contable|libro iva|firma|cobr|pago/],
  ['Productos y precios', /producto|precio|catálogo|lista|promo|etiqueta|foto|categor/],
  ['Clientes', /cliente|cuenta corriente|cta\.? cte|agenda|sponsor/],
  ['Tienda web', /tienda|\bweb\b|tienda nube|tiendanube/],
  ['App', /\bapp\b|celular|móvil|mobile/],
  ['Informes y estadísticas', /informe|estadística|reporte|tablero|gráfic/],
  ['Equipo y permisos', /usuario|\brol\b|permiso|menú|clave|login|contraseña/],
  ['Servidor y seguridad', /servidor|seguridad|railway|docker|backup|deploy|publica/],
];

const PIDIO_ENTRE_PARENTESIS = /\s*\(?[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?: [A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)?,\s*\d{1,2}\/\d{1,2}\/\d{4}[^)]*\)?\.?\s*$/;
const mayuscula = (t) => t.charAt(0).toUpperCase() + t.slice(1);

export function clasificarSinIA(mensaje, partes = []) {
  const primera = mensaje.split('\n')[0].trim();
  const limpia = primera.replace(/\s*\(?propuesta de metogroup[^)]*\)?\.?\s*$/i, '').replace(PIDIO_ENTRE_PARENTESIS, '').trim();
  const dos = limpia.indexOf(':');
  const titulo = (dos > 0 && dos <= 70 ? limpia.slice(0, dos) : limpia.split(/[,.;(]/)[0]).trim().slice(0, 90);
  const que = (dos > 0 && dos <= 70 ? limpia.slice(dos + 1) : limpia).trim();
  const m = mensaje.toLowerCase();
  const t = titulo.toLowerCase();
  const area = (AREAS_REGLAS.find(([, re]) => re.test(t)) ?? AREAS_REGLAS.find(([, re]) => re.test(m)))?.[0]
    ?? (partes.includes('tienda') ? 'Tienda web' : partes.includes('app') ? 'App' : partes.includes('servidor') ? 'Servidor y seguridad' : 'Administración y cobros');
  const tipo = /\berror|fallaba|falla\b|no abr[ií]a|no andaba|no cargaba|no aparec[ií]a|no se ve[ií]a|no llegaba|se colgaba|colgad|romp[ií]a|rompían|\broto|\b(500|403|404)\b|duplicad|se perd[ií]a|quedaba trabad|\bbug|arregla el|corrige el error/.test(m)
    ? 'bug'
    : /(pantalla|función|módulo|sección|pestaña|perfil|botón|tablero|informe|reporte|entrada|lista|filtro|aviso)s? nuev[oa]s?|nuev[oa]s? (pantalla|función|módulo|sección|pestaña|perfil|botón|tablero|informe)|\balta de\b|integraci[oó]n con|primera versión|ahora se puede|se suma(n)? |se agreg/.test(m) || /^nuev|^m[oó]dulo/.test(t)
      ? 'nuevo'
      : /arregl|corrig|en vez de|\bya no\b|vuelve |deja de|sin trabar|equivoc|mal\b|no tiene que|nunca más|candado|regla/.test(m)
        ? 'arreglo'
        : 'mejora';
  return { tipo, area, titulo: mayuscula(titulo), que_se_hizo: mayuscula(que || titulo), para_que: null, pidio: null };
}

// ---- la base ---------------------------------------------------------------

async function hashesCargados() {
  const vistos = new Set();
  for (let desde = 0; ; desde += 1000) {
    const res = await fetch(`${BASE}?select=hash`, { headers: { ...CAB, Range: `${desde}-${desde + 999}` } });
    if (!res.ok) throw new Error(`Supabase respondió ${res.status}: ${await res.text()}`);
    const filas = await res.json();
    for (const f of filas) vistos.add(f.hash);
    if (filas.length < 1000) return vistos;
  }
}

async function guardar(filas) {
  for (let i = 0; i < filas.length; i += 200) {
    const res = await fetch(`${BASE}?on_conflict=hash`, {
      method: 'POST',
      headers: { ...CAB, Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(filas.slice(i, i + 200)),
    });
    if (!res.ok) throw new Error(`Supabase respondió ${res.status}: ${await res.text()}`);
  }
}

async function actualizarMinutos(minutos, cargados) {
  for (const [hash, m] of minutos) {
    if (!cargados.has(hash)) continue;
    const res = await fetch(`${BASE}?hash=eq.${hash}`, { method: 'PATCH', headers: { ...CAB, Prefer: 'return=minimal' }, body: JSON.stringify({ minutos: m }) });
    if (!res.ok) throw new Error(`Supabase respondió ${res.status}: ${await res.text()}`);
  }
}

// ---- todo junto ------------------------------------------------------------

async function main() {
  const commits = leerCommits();
  const minutos = estimarMinutos(commits);
  const cargados = await hashesCargados();
  const nuevos = commits.filter((c) => c.cuenta && !cargados.has(c.hash)).slice(0, LIMITE);
  console.log(`Mantenimiento: ${commits.filter((c) => c.cuenta).length} trabajos en ${REF}, ${nuevos.length} sin cargar.`);
  for (let i = 0; i < nuevos.length; i += 25) {
    const lote = nuevos.slice(i, i + 25);
    const clases = CLAVE_IA ? await clasificar(lote).catch((e) => (console.log(`  sin IA (${e.message.slice(0, 80)})`), new Map())) : new Map();
    const filas = lote.map((c) => {
      const k = clases.get(c.hash) ?? clasificarSinIA(c.mensaje, c.partes);
      const p = pedidoDe(c.mensaje);
      const pidio = p.pidio ?? k.pidio ?? null;
      return {
        hash: c.hash,
        publicado_en: c.fecha.toISOString(),
        mes: mesDe(c.fecha),
        // sin nadie que lo pidiera, la idea fue nuestra
        // propuesta: la idea fue de MetoGroup y el mensaje lo dice («(Propuesta de
        // MetoGroup, 9/11/2026)»); los commits viejos que no dicen quién lo pidió
        // quedan sin pedido, no como propuesta
        tipo: p.propuesta ? 'propuesta' : k.tipo === 'propuesta' && pidio ? 'mejora' : k.tipo,
        area: k.area,
        titulo: k.titulo,
        que_se_hizo: k.que_se_hizo,
        para_que: k.para_que,
        pidio,
        pedido_el: p.pedido_el,
        cita: p.cita,
        mensaje: c.mensaje,
        minutos: minutos.get(c.hash) ?? 5,
        partes: c.partes,
        archivos: c.archivos,
        lineas: c.lineas,
      };
    });
    await guardar(filas);
    console.log(`  cargados ${Math.min(i + 25, nuevos.length)} de ${nuevos.length}`);
  }
  if (RECALCULAR) {
    await actualizarMinutos(minutos, await hashesCargados());
    console.log('  minutos recalculados');
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(`Mantenimiento: ${e.message}`); process.exit(1); });
}
