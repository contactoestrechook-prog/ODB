// Patrón de carga de listas de proveedor (reusable):
//   node procesar-lista.mjs <archivoTexto> <proveedor> [vigencia] [markup]
// Da de alta el proveedor, crea la base persistente de la lista, matchea contra
// el catálogo (guardián de marca) y a los matcheados les pone costo + precio
// Minorista = costo*markup. Los no matcheados quedan en la base.
import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'node:fs';

const [, , archivo, proveedorNombre, vigencia = '', markupArg = '1.6'] = process.argv;
if (!archivo || !proveedorNombre) {
  console.error('uso: node procesar-lista.mjs <archivoTexto> <proveedor> [vigencia] [markup]');
  process.exit(1);
}
const MARKUP = Number(markupArg);

const env = Object.fromEntries(
  readFileSync(new URL('../../apps/api/.env', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);
process.env.ANTHROPIC_API_KEY = env.ANTHROPIC_API_KEY;
const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const claude = new Anthropic();

const ESQUEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          codigo: { type: ['string', 'null'] },
          descripcion: { type: 'string' },
          presentacion: { type: ['string', 'null'] },
          costo: { type: 'string' },
        },
        required: ['codigo', 'descripcion', 'presentacion', 'costo'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
};

const INSTRUCCION = `Esta es una lista de precios de un proveedor (bebidas y/o fiambrería) para un comercio. Las filas vienen alineadas (cada renglón es un producto con sus columnas). Extraé TODOS los renglones de PRODUCTOS.
Por cada producto: codigo (código del proveedor si aparece), descripcion (que EMPIECE por la marca cuando se vea, ej "Casa Boher Gran Malbec"), presentacion (ej "750cc", "6x750", "1.5 KG" si figura), y costo.

COSTO = el precio que el comercio PAGA por UNA unidad (botella/pieza), ya con la bonificación/descuento aplicada e IVA incluido. Suele ser la columna rotulada "x BOT.", "x Unidad", "Precio bonif. por botella" o el "Final c/IVA" por unidad.
NO uses, para el costo: el precio por CAJA; ni el precio de lista SIN bonificar; ni la columna de precio SUGERIDO / "SUGER" / "VENTA" / "público" (suele ser el ÚLTIMO número del renglón y el más alto). Si SOLO hay precio por caja y conocés las unidades por caja, dividí caja/unidades.

Devolvé el costo como TEXTO, tal cual aparece en la lista, SIN el símbolo $ (ej "166.600", "77.000", "12.809,67"). No lo conviertas a número, copialo literal.
Ignorá encabezados, nombres de sección (ESPUMANTES, VINOS), totales, texto legal y filas sin precio. Si una fila dice "s/stock" igual incluila con su costo.`;

const texto = readFileSync(archivo, 'utf8');
const paginas = texto.split(/(?==== PÁGINA )/);
const tandas = [];
let actual = '';
for (const p of paginas) {
  if (actual.length + p.length > 55_000 && actual) { tandas.push(actual); actual = ''; }
  actual += p;
}
if (actual.trim()) tandas.push(actual);

console.log(`\n=== ${proveedorNombre} ===  (${tandas.length} tanda/s, markup x${MARKUP})`);

const resultados = await Promise.all(
  tandas.map(async (tanda, i) => {
    const r = await claude.messages
      .stream({
        model: 'claude-haiku-4-5',
        max_tokens: 32000,
        output_config: { format: { type: 'json_schema', schema: ESQUEMA } },
        messages: [{ role: 'user', content: [
          { type: 'text', text: `Texto de la lista (parte ${i + 1}/${tandas.length}):\n\n${tanda}` },
          { type: 'text', text: INSTRUCCION },
        ] }],
      })
      .finalMessage();
    const bloque = r.content.find((b) => b.type === 'text');
    return JSON.parse(bloque?.text ?? '{"items":[]}').items;
  }),
);
// parser robusto AR y US: "166.600"->166600 · "12.809,67"->12809.67 · "89,000.00"->89000
const parseNum = (s) => {
  let t = String(s ?? '').replace(/[^\d.,]/g, '');
  if (!t) return 0;
  const ld = t.lastIndexOf('.'), lc = t.lastIndexOf(',');
  let dec = '';
  if (ld >= 0 && lc >= 0) dec = ld > lc ? '.' : ',';
  else if (ld >= 0) dec = t.length - ld - 1 <= 2 ? '.' : '';
  else if (lc >= 0) dec = t.length - lc - 1 <= 2 ? ',' : '';
  if (dec === '.') t = t.replace(/,/g, '');
  else if (dec === ',') t = t.replace(/\./g, '').replace(',', '.');
  else t = t.replace(/[.,]/g, '');
  const n = Number(t);
  return Number.isFinite(n) ? n : 0;
};
let items = resultados.flat().map((i) => ({ ...i, costoNum: parseNum(i.costo) })).filter((i) => i.descripcion && i.costoNum > 0);
const vistos = new Set();
items = items.filter((i) => { const k = (i.codigo ?? '') + '|' + i.descripcion; if (vistos.has(k)) return false; vistos.add(k); return true; });
console.log(`Extraídos: ${items.length}`);

// proveedor (alta si no existe)
let { data: prov } = await db.from('proveedores').select('id').eq('razon_social', proveedorNombre).maybeSingle();
if (!prov) {
  ({ data: prov } = await db.from('proveedores').insert({ razon_social: proveedorNombre }).select('id').single());
  console.log(`Proveedor dado de alta: ${proveedorNombre}`);
} else {
  console.log(`Proveedor existente: ${proveedorNombre}`);
}
// re-run limpio: borro la base anterior de este proveedor (los precios nuevos
// superan a los viejos por vigente_desde más reciente)
await db.from('listas_proveedor').delete().eq('proveedor_id', prov.id);

// matching con guardián de marca
const normalizar = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/gi, '').toLowerCase();
const mismaMarca = (desc, nombre) => {
  const pal = normalizar(desc).split(/\s+/).filter((p) => p.length >= 3);
  return !pal.length || normalizar(nombre).includes(pal[0]);
};
let proc = 0;
const cola = [...items];
await Promise.all(Array.from({ length: 8 }, async () => {
  while (cola.length) {
    const it = cola.shift();
    const { data: sim } = await db.rpc('buscar_producto_similar', { p_texto: it.descripcion }).maybeSingle();
    proc++;
    // umbral alto + guardián de marca: mejor sub-matchear que poner precios mal
    if (sim && sim.similitud >= 0.42 && mismaMarca(it.descripcion, sim.nombre)) { it.sku = sim.sku; it.match = sim.nombre; }
  }
}));
const matcheados = items.filter((i) => i.sku);
console.log(`Matcheados con el catálogo: ${matcheados.length} / ${items.length}`);

// base persistente
const { data: lista } = await db.from('listas_proveedor')
  .insert({ proveedor_id: prov.id, archivo: archivo.split('/').pop(), vigencia, markup: MARKUP, items_total: items.length, items_match: matcheados.length })
  .select('id').single();
const filas = items.map((i) => ({
  lista_id: lista.id, codigo: i.codigo ?? null, descripcion: i.descripcion, presentacion: i.presentacion ?? null,
  costo: i.costoNum, precio_sugerido: Math.round(i.costoNum * MARKUP * 100) / 100,
  producto_id: null, sku: i.sku ?? null,
}));
for (let k = 0; k < filas.length; k += 300) await db.from('listas_proveedor_items').insert(filas.slice(k, k + 300));
console.log(`Base guardada (listas_proveedor_items): ${filas.length} renglones`);

// aplicar costo + precio a los matcheados (UN costo por sku: el más alto, para
// que precio = costo*markup quede consistente aunque varios renglones matcheen)
const porSku = new Map();
for (const m of matcheados) {
  const prev = porSku.get(m.sku);
  if (!prev || m.costoNum > prev.costo) porSku.set(m.sku, { sku: m.sku, costo: m.costoNum, precio: Math.round(m.costoNum * MARKUP * 100) / 100 });
}
const aplicar = [...porSku.values()];
let aplicados = 0;
for (let k = 0; k < aplicar.length; k += 200) {
  const { data, error } = await db.rpc('aplicar_lista_con_precio', { p_proveedor: prov.id, p_items: aplicar.slice(k, k + 200) });
  if (error) throw new Error(error.message);
  aplicados += data ?? 0;
}
console.log(`Costos + precios aplicados: ${aplicados}`);
console.log('Muestra:');
for (const m of matcheados.slice(0, 4)) console.log(`  "${m.descripcion}" → ${m.match}  costo $${Math.round(m.costoNum)} → público $${Math.round(m.costoNum * MARKUP)}`);

// --- análisis comparativo vs otros proveedores ---
const { data: cmp } = await db.rpc('analizar_proveedor', { p_proveedor: prov.id });
if (cmp?.length) {
  const barato = cmp.filter((c) => c.este_mas_barato);
  const caro = cmp.filter((c) => !c.este_mas_barato);
  console.log(`\nComparación vs otros proveedores (${cmp.length} en común): ${proveedorNombre} es el más barato en ${barato.length}, más caro en ${caro.length}`);
  for (const c of caro.slice(-3)) console.log(`  ⚠ ${c.nombre}: acá $${Math.round(c.costo_este)} vs $${Math.round(c.mejor_otro)} en ${c.prov_otro} (${c.diff_pct}% más caro)`);
  for (const c of barato.slice(0, 3)) console.log(`  ✓ ${c.nombre}: acá $${Math.round(c.costo_este)} (más barato que ${c.prov_otro} a $${Math.round(c.mejor_otro)})`);
} else {
  console.log('Sin productos en común con otros proveedores todavía.');
}
console.log('LISTO ✓');
