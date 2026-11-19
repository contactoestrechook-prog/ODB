// REPASO DE LA PREGUNTA DE MARCA (19/11/2026). Solo lee. Recorre los renglones
// registrados (compras_historial) y pregunta, con la regla de hoy y con la
// nueva, si «Antes de registrar» habría frenado con «¿es el mismo producto?».
//   · Falsas alarmas: el renglón con el producto con que una persona lo registró.
//   · Alarmas que tienen que seguir: el renglón con el producto que había puesto
//     el lector cuando la persona lo cambió por otro de otra marca.
//
//   cd apps/api && npx ts-node --transpile-only scripts/repasar-marca.ts [ruta al .env]
//
// Sale con código 1 si la regla nueva deja pasar una alarma que la de hoy daba.
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { marcaDelRenglon, mismaMarca, otraMarca } from '../src/listas/marca';

const rutaEnv = process.argv[2] ?? '.env';
const env = Object.fromEntries(readFileSync(rutaEnv, 'utf8').split('\n').map((l) => l.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean).map((m) => [m![1], m![2].replace(/^["']|["']$/g, '')]));
const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY || env.SUPABASE_KEY, { auth: { persistSession: false } });

async function todo<T>(tabla: string, columnas: string, orden: string[], filtro?: (q: any) => any): Promise<T[]> {
  const salida: T[] = [];
  for (let d = 0; ; d += 1000) {
    let q: any = db.from(tabla).select(columnas);
    if (filtro) q = filtro(q);
    for (const o of orden) q = q.order(o);
    const { data, error } = await q.range(d, d + 999);
    if (error) throw new Error(`${tabla}: ${error.message}`);
    salida.push(...(data ?? []));
    if ((data ?? []).length < 1000) break;
  }
  return salida;
}

const viejaAlarma = (d: string, p: string) => !!marcaDelRenglon(d) && !mismaMarca(d, p);
const nuevaAlarma = (d: string, p: string) => otraMarca(d, p);

(async () => {
  const historial = await todo<any>('compras_historial', 'lectura_id, renglon, descripcion, producto_id, incluido, es_descuento', ['creado_en', 'renglon'], (q) => q.eq('incluido', true).eq('es_descuento', false).not('producto_id', 'is', null));
  const productos = new Map<string, any>();
  for (const p of await todo<any>('productos', 'id, sku, nombre', ['id'])) productos.set(p.id, p);
  const idsLectura = [...new Set(historial.map((h) => h.lectura_id).filter(Boolean))] as string[];
  const lecturas = new Map<string, any[]>();
  for (let k = 0; k < idsLectura.length; k += 20) {
    const { data, error } = await db.from('lecturas_comprobante').select('id, items:resultado->items').in('id', idsLectura.slice(k, k + 20));
    if (error) throw new Error(error.message);
    for (const l of data ?? []) lecturas.set(l.id, Array.isArray(l.items) ? l.items : []);
  }

  // falsas alarmas: pares (texto del papel, producto registrado), sin repetir
  const pares = new Map<string, { d: string; p: string; n: number }>();
  // alarmas que tienen que seguir: el lector vinculó X, la persona registró Y
  const corregidos = new Map<string, { d: string; mal: string; bien: string }>();
  for (const h of historial) {
    const prod = productos.get(h.producto_id);
    if (!prod?.nombre || !h.descripcion) continue;
    const k = `${h.descripcion}|${prod.nombre}`;
    const par = pares.get(k) ?? { d: h.descripcion, p: prod.nombre, n: 0 };
    par.n += 1;
    pares.set(k, par);
    const items = lecturas.get(h.lectura_id) ?? [];
    // el renglón del historial es la posición en la lectura (desde 0); se confirma con el texto
    const it = [items[h.renglon], items[h.renglon - 1]].find((x) => x && String(x.descripcion ?? '') === h.descripcion);
    const sku = it?.match?.sku, nombreLector = it?.match?.nombre;
    if (sku && nombreLector && sku !== prod.sku && !mismaMarca(nombreLector, prod.nombre)) {
      corregidos.set(`${h.descripcion}|${nombreLector}`, { d: h.descripcion, mal: nombreLector, bien: prod.nombre });
    }
  }

  let vieja = 0, nueva = 0, viejaN = 0, nuevaN = 0;
  const quedan: string[] = [];
  for (const { d, p, n } of pares.values()) {
    const v = viejaAlarma(d, p), w = nuevaAlarma(d, p);
    if (v) { vieja += 1; viejaN += n; }
    if (w) { nueva += 1; nuevaN += n; quedan.push(`  «${d}» → «${p}» (${n})`); }
  }
  console.log(`Renglones registrados: ${historial.length} · pares texto→producto distintos: ${pares.size}`);
  console.log(`FALSAS ALARMAS («¿es el mismo producto?» sobre lo que se registró): hoy ${vieja} pares (${viejaN} renglones) · nueva ${nueva} pares (${nuevaN} renglones)`);
  console.log(`Las que la nueva sigue preguntando (${quedan.length}, las primeras 40):`);
  console.log(quedan.slice(0, 40).join('\n'));

  let siguenV = 0, siguenN = 0;
  const perdidas: string[] = [];
  for (const { d, mal, bien } of corregidos.values()) {
    const v = viejaAlarma(d, mal), w = nuevaAlarma(d, mal);
    if (v) siguenV += 1;
    if (w) siguenN += 1;
    if (v && !w) perdidas.push(`  «${d}»: el lector puso «${mal}», se registró «${bien}»`);
  }
  console.log(`\nVÍNCULOS MAL DEL LECTOR que una persona cambió por otra marca: ${corregidos.size} · hoy pregunta en ${siguenV} · la nueva en ${siguenN}`);
  if (perdidas.length) {
    console.log('LA NUEVA DEJA PASAR:');
    console.log(perdidas.join('\n'));
    process.exit(1);
  }
})().catch((e) => { console.error(e); process.exit(2); });
