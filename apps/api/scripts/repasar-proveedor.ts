// REPASO DEL PROVEEDOR POR SUS ARTÍCULOS (17/11/2026). Recorre las facturas
// registradas en orden y, para cada una, pregunta qué proveedor habría elegido
// compras/proveedor-por-articulos.ts con lo que se sabía HASTA ese día. Lo
// compara con el proveedor con el que la persona la registró. Solo lee.
//
//   cd apps/api && npx ts-node --transpile-only scripts/repasar-proveedor.ts [ruta al .env]
//
// Sale con código 1 si alguna vez habría elegido un proveedor equivocado.
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { claveArticulo } from '../src/compras/ficha-articulo';
import { proveedorPorArticulos, type ArticuloConocido } from '../src/compras/proveedor-por-articulos';

const rutaEnv = process.argv[2] ?? '.env';
const env = Object.fromEntries(readFileSync(rutaEnv, 'utf8').split('\n').map((l) => l.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean).map((m) => [m![1], m![2].replace(/^["']|["']$/g, '')]));
const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY || env.SUPABASE_KEY, { auth: { persistSession: false } });

async function todo<T>(tabla: string, columnas: string, orden: string[]): Promise<T[]> {
  const salida: T[] = [];
  for (let d = 0; ; d += 1000) {
    let q: any = db.from(tabla).select(columnas);
    for (const o of orden) q = q.order(o);
    const { data, error } = await q.range(d, d + 999);
    if (error) throw new Error(`${tabla}: ${error.message}`);
    salida.push(...(data ?? []));
    if ((data ?? []).length < 1000) break;
  }
  return salida;
}

(async () => {
  const historial = await todo<any>('compras_historial', 'proveedor_id, lectura_id, numero, fecha, renglon, descripcion, es_descuento, creado_en', ['creado_en', 'renglon']);
  const idsLectura = [...new Set(historial.map((h) => h.lectura_id).filter(Boolean))] as string[];
  const lecturas = new Map<string, any>();
  for (let k = 0; k < idsLectura.length; k += 20) {
    const { data, error } = await db.from('lecturas_comprobante').select('id, creado_en, items:resultado->items, proveedor:resultado->proveedor').in('id', idsLectura.slice(k, k + 20));
    if (error) throw new Error(error.message);
    for (const l of data ?? []) lecturas.set(l.id, l);
  }
  const { data: provs } = await db.from('proveedores').select('id, razon_social, nombre_fantasia');
  const nombre = new Map((provs ?? []).map((p: any) => [p.id, p.nombre_fantasia || p.razon_social]));
  // una factura = una lectura registrada
  const facturas = new Map<string, any[]>();
  for (const h of historial) {
    if (!h.lectura_id) continue;
    facturas.set(h.lectura_id, [...(facturas.get(h.lectura_id) ?? []), h]);
  }
  const conocidos: ArticuloConocido[] = [];
  const t = { sinReconocer: 0, acierta: 0, erra: 0, calla: 0, callaSinHistoria: 0, reconocidas: 0, coincide: 0, contradice: 0 };
  const errores: string[] = [];
  const aciertos: string[] = [];
  const callados: string[] = [];
  const yaVino = new Set<string>();
  for (const [lecturaId, grupo] of facturas) {
    const l = lecturas.get(lecturaId);
    const real = grupo[0].proveedor_id;
    const items: any[] = Array.isArray(l?.items) ? l.items : [];
    if (items.length) {
      const claves = items.filter((i) => !i?.esDescuento).map((i) => claveArticulo(i?.descripcion)).filter(Boolean);
      const r = proveedorPorArticulos(claves, conocidos);
      const reconocido = l?.proveedor?.match?.id ?? null;
      const cuit = String(l?.proveedor?.detectado?.cuit ?? '').replace(/\D/g, '');
      const etiqueta = `${String(l?.creado_en ?? '').slice(5, 16)} ${String(nombre.get(real) ?? '').slice(0, 24)} (${claves.length} renglones)`;
      if (!reconocido && cuit.length !== 11) {
        t.sinReconocer++;
        if (!r) { t.calla++; if (!yaVino.has(real)) t.callaSinHistoria++; else callados.push(etiqueta); }
        else if (r.proveedorId === real) { t.acierta++; aciertos.push(`${etiqueta} · ${r.coinciden} de ${r.de}`); }
        else { t.erra++; errores.push(`${etiqueta} · habría elegido ${nombre.get(r.proveedorId)} (${r.coinciden} de ${r.de})`); }
      } else {
        // las que el lector ya reconoció (o traían CUIT): ahí no se usa, pero sirve de control
        t.reconocidas++;
        if (r && r.proveedorId === real) t.coincide++;
        else if (r) { t.contradice++; errores.push(`[control] ${etiqueta} · por artículos saldría ${nombre.get(r.proveedorId)} (${r.coinciden} de ${r.de})`); }
      }
    }
    // después de mirarla, se aprende de ella (igual que al registrar)
    for (const h of grupo) if (!h.es_descuento) conocidos.push({ proveedor_id: real, clave: claveArticulo(h.descripcion) });
    yaVino.add(real);
  }
  console.log(`\nEL PROVEEDOR POR SUS ARTÍCULOS · ${new Date().toISOString().slice(0, 10)}`);
  console.log(`Facturas registradas que el lector NO reconoció y no traían CUIT: ${t.sinReconocer}`);
  console.log(`  lo habría reconocido bien: ${t.acierta}`);
  console.log(`  HABRÍA ELEGIDO OTRO: ${t.erra}`);
  console.log(`  no dice nada: ${t.calla} (de esas, ${t.callaSinHistoria} eran la primera factura de ese proveedor)`);
  console.log(`Control sobre las ${t.reconocidas} que el lector sí reconoció: coincide en ${t.coincide}, contradice en ${t.contradice}`);
  if (aciertos.length) console.log(`\nReconocidas por sus artículos:\n${aciertos.map((x) => `  + ${x}`).join('\n')}`);
  if (callados.length) console.log(`\nYa había venido y no lo reconoce:\n${callados.map((x) => `  · ${x}`).join('\n')}`);
  if (errores.length) console.log(`\nERRORES:\n${errores.map((x) => `  ! ${x}`).join('\n')}`);
  process.exit(t.erra || t.contradice ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
