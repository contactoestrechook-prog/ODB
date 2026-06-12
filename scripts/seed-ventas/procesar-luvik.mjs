// Procesa el catálogo mayorista de Luvik (texto ya extraído) fuera del ciclo HTTP:
// 5 tandas de IA en paralelo + matching con concurrencia contra el catálogo real.
//   node procesar-luvik.mjs
import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, writeFileSync } from 'node:fs';

const PROVEEDOR_ID = '504ee78d-6744-4a62-93d8-47f595528b19'; // Luvik Mayorista

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
          precio: { type: 'number' },
        },
        required: ['codigo', 'descripcion', 'precio'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
};

const INSTRUCCION =
  'Esta es una lista de precios de un proveedor mayorista. Extraé TODOS los renglones de productos con su código (el número junto a "COD." si existe), descripción y precio unitario en pesos. La descripción debe EMPEZAR por la marca cuando esté visible (ej: "Gallo Arroz Parboil 1kg"). Ignorá combos, encabezados, totales, texto legal y decorativo.';

// --- 1. tandas ---
const texto = readFileSync('/tmp/catalogo-luvik.txt', 'utf8');
const paginas = texto.split(/(?==== PÁGINA )/);
const tandas = [];
let actual = '';
for (const p of paginas) {
  if (actual.length + p.length > 55_000 && actual) { tandas.push(actual); actual = ''; }
  actual += p;
}
if (actual.trim()) tandas.push(actual);
console.log(`Tandas de IA: ${tandas.length} (en paralelo)`);

// --- 2. extracción en paralelo ---
const resultados = await Promise.all(
  tandas.map(async (tanda, i) => {
    const r = await claude.messages
      .stream({
        model: 'claude-opus-4-8',
        max_tokens: 64000,
        output_config: { format: { type: 'json_schema', schema: ESQUEMA } },
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: `Texto del catálogo (parte ${i + 1} de ${tandas.length}):\n\n${tanda}` },
              { type: 'text', text: INSTRUCCION },
            ],
          },
        ],
      })
      .finalMessage();
    const bloque = r.content.find((b) => b.type === 'text');
    const datos = JSON.parse(bloque?.text ?? '{"items":[]}');
    console.log(`  tanda ${i + 1}: ${datos.items.length} renglones`);
    return datos.items;
  }),
);
let items = resultados.flat();
// dedupe por código de proveedor
const vistos = new Set();
items = items.filter((i) => {
  const clave = i.codigo ?? i.descripcion;
  if (vistos.has(clave)) return false;
  vistos.add(clave);
  return true;
});
console.log(`Extraídos (únicos): ${items.length}`);

// --- 3. matching con concurrencia + guardián de marca ---
const normalizar = (s) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/gi, '').toLowerCase();
const mismaMarca = (desc, nombre) => {
  const palabras = normalizar(desc).split(/\s+/).filter((p) => p.length >= 3);
  return !palabras.length || normalizar(nombre).includes(palabras[0]);
};

const matcheados = [];
const sinMatch = [];
let procesados = 0;
const cola = [...items];
await Promise.all(
  Array.from({ length: 10 }, async () => {
    while (cola.length) {
      const item = cola.shift();
      const { data: similar } = await db
        .rpc('buscar_producto_similar', { p_texto: item.descripcion })
        .maybeSingle();
      procesados++;
      if (procesados % 200 === 0) console.log(`  matching: ${procesados}/${items.length}`);
      if (similar && mismaMarca(item.descripcion, similar.nombre)) {
        matcheados.push({ item, sku: similar.sku, nombre: similar.nombre });
      } else {
        sinMatch.push(item);
      }
    }
  }),
);
console.log(`Matcheados: ${matcheados.length} · sin matchear: ${sinMatch.length}`);

// --- 4. aplicar costos ---
const aplicar = matcheados.map((m) => ({ sku: m.sku, costo: m.item.precio }));
for (let i = 0; i < aplicar.length; i += 200) {
  const { error } = await db.rpc('aplicar_lista_proveedor', {
    p_proveedor: PROVEEDOR_ID,
    p_items: aplicar.slice(i, i + 200),
  });
  if (error) throw new Error(error.message);
}
console.log(`Costos aplicados: ${aplicar.length}`);

writeFileSync('/tmp/luvik-resultado.json', JSON.stringify({ matcheados, sinMatch }, null, 1));
console.log('Detalle → /tmp/luvik-resultado.json');
console.log('LISTO ✓');