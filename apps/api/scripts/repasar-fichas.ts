// REPASO DE LA FICHA DEL ARTÍCULO CONTRA LAS FACTURAS YA REGISTRADAS (11/11/2026).
//
// Recorre todo lo registrado (compras_historial) en orden de fecha, como si la
// memoria se hubiera ido aprendiendo factura por factura. Para cada factura
// que tiene su lectura guardada, arma los renglones como los arma la pantalla,
// les aplica las fichas aprendidas HASTA ESE DÍA y compara lo que queda con lo
// que la persona terminó registrando.
//
// Solo lee. No usa IA. Sirve para dos cosas: medir cuánto ayuda la ficha y
// frenar una publicación si alguna vez deja mal un renglón que estaba bien.
//
//   cd apps/api && npx ts-node --transpile-only scripts/repasar-fichas.ts [ruta al .env]
//
// Sale con código 1 si la ficha dejó MAL algún renglón que la lectura traía bien.
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { claveArticulo, fichaTrasRegistro, presentacionDeRenglon, type Presentacion } from '../src/compras/ficha-articulo';
import { cambiosDeFicha, type FichaArticulo } from '../../admin/app/lib/ficha-articulo';
import { aplicarCambiosIA, frenarReglasAbsurdas, papelDeLectura } from '../../admin/app/lib/tabla-factura';
import { fichaDeForma, firmaDe, formaDe, type Antecedente } from '../../admin/app/lib/forma-proveedor';
import { esRenglonDescuento } from '../../admin/app/lib/descuentos-compras';

const rutaEnv = process.argv[2] ?? '.env';
const env = Object.fromEntries(readFileSync(rutaEnv, 'utf8').split('\n').map((l) => l.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean).map((m) => [m![1], m![2].replace(/^["']|["']$/g, '')]));
const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY || env.SUPABASE_KEY, { auth: { persistSession: false } });

const num = (v: unknown): number | null => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const cerca = (a: number | null, b: number | null) => a != null && b != null && Math.abs(a - b) <= 0.002 * Math.max(1, Math.abs(b));

/** El renglón como lo arma la pantalla al cargar una lectura (ComprasWorkspace, «filas»). */
function filaDeLectura(i: any): Record<string, any> {
  const r = i.interpretado ?? {};
  const cantidad = r.cantidad ?? i.cantidad ?? '';
  const porPeso = !!r.porPeso;
  const envase = r.decision === 'unidades_a_envase' && Number(r.cantidadOriginal) > 0 && cantidad > 0 ? Math.round(Number(r.cantidadOriginal) / cantidad) : null;
  return {
    descripcion: i.descripcion, cantidad, porPeso, kg: i.kg ?? null,
    precio: envase && Number(r.precioPropuesto) > 0 ? Number(r.precioPropuesto) : i.precio ?? '',
    envaseAplicado: envase, sku: i.match?.sku ?? '', sugerido: i.match?.sugerido === true,
    costoCatalogo: i.match?.costoActual ?? null, razonBulto: r.razonBulto ?? null,
    unidadesPorBulto: r.unidadesPorBulto ?? null,
    bonificacionPct: r.bonificacionPct ?? i.bonificacionPct ?? null,
    importe: r.importeNeto ?? i.importe ?? null,
    esDescuento: !!i.esDescuento, esDevolucion: !!i.esDevolucion, devueltoAMano: !!i.devueltoAMano,
    papel: i.esDescuento || i.esDevolucion || porPeso ? null : papelDeLectura({ ...i, unidadesDelCatalogo: i.unidadesDelCatalogo ?? null }),
  };
}

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
  const historial = await todo<any>('compras_historial',
    'proveedor_id, lectura_id, numero, fecha, renglon, producto_id, descripcion, bultos, unidades_por_bulto, sueltas, entra_como, cantidad_stock, importe, incluido, es_descuento, creado_en',
    ['fecha', 'creado_en', 'renglon']);
  const idsLectura = [...new Set(historial.map((h) => h.lectura_id).filter(Boolean))] as string[];
  const lecturas = new Map<string, any>();
  for (let k = 0; k < idsLectura.length; k += 20) {
    const { data, error } = await db.from('lecturas_comprobante').select('id, resultado').in('id', idsLectura.slice(k, k + 20));
    if (error) throw new Error(error.message);
    for (const l of data ?? []) lecturas.set(l.id, l.resultado);
  }
  const { data: provs } = await db.from('proveedores').select('id, razon_social, nombre_fantasia');
  const nombre = new Map((provs ?? []).map((p: any) => [p.id, p.nombre_fantasia || p.razon_social]));

  // las facturas, en el orden en que se registraron
  const facturas = new Map<string, any[]>();
  for (const h of historial) {
    const k = `${h.proveedor_id}|${h.fecha}|${h.numero ?? h.lectura_id ?? h.creado_en}`;
    facturas.set(k, [...(facturas.get(k) ?? []), h]);
  }

  type Ficha = Presentacion & { veces: number; ultimaFactura: string | null; ultimaFecha: string | null; productoId: string | null };
  const memoria = new Map<string, Map<string, Ficha>>(); // proveedor → clave → ficha
  const t = { facturas: 0, conLectura: 0, renglones: 0, conFicha: 0, yaEstaban: 0, arregladas: 0, noAlcanzo: 0, rotas: 0, noCierra: 0, noAplica: 0, sinFicha: 0, sinFichaMal: 0 };
  const rotas: string[] = [];
  const arregladas: string[] = [];
  const faltaron: string[] = [];
  // LA PRÓXIMA VEZ: la misma lectura, con la ficha que deja ESA factura al registrarse.
  // Es lo que pasa cuando el artículo vuelve a venir igual.
  const prox = { corregidos: 0, resueltos: 0, sinFicha: 0, noAplica: 0, noCierra: 0, distinto: 0, bien: 0, bienRotos: 0 };
  const proxFaltan: string[] = [];
  const proxRotos: string[] = [];
  // LA FORMA DEL PROVEEDOR (17/11/2026): los artículos que vienen por primera vez
  // con «×N» sin decidir, contra lo que ese proveedor ya mostró en sus facturas
  // anteriores. «mal» es lo único grave: la forma decidió y quedó distinto de lo
  // que la persona registró.
  const antecedentes = new Map<string, Antecedente[]>(); // proveedor → renglones ya registrados con su lectura
  const fm = { sinDecidir: 0, bien: 0, mal: 0, noDecide: 0, noCierra: 0, frenadas: 0 };
  const formaBien: string[] = [];
  const formaMal: string[] = [];
  const formaFalta: string[] = [];
  // para «la próxima vez»: cada renglón sin decidir, contra TODO lo demás que ese proveedor ya tiene registrado
  const sinDecidir: { proveedor: string; etiqueta: string; fila: Record<string, any>; registrado: number; descripcion: string }[] = [];

  for (const grupo of facturas.values()) {
    t.facturas++;
    const g0 = grupo[0];
    const delProv = memoria.get(g0.proveedor_id) ?? new Map<string, Ficha>();
    memoria.set(g0.proveedor_id, delProv);
    const resultado = g0.lectura_id ? lecturas.get(g0.lectura_id) : null;
    const items: any[] = Array.isArray(resultado?.items) ? resultado.items : [];
    if (items.length) {
      t.conLectura++;
      const porProducto = new Map<string, Ficha[]>();
      for (const f of delProv.values()) if (f.productoId) porProducto.set(f.productoId, [...(porProducto.get(f.productoId) ?? []), f]);
      for (const h of grupo) {
        // el renglón registrado y el leído, por posición y con la misma descripción
        const i = items[Number(h.renglon) - 1];
        if (!i || String(i.descripcion ?? '') !== String(h.descripcion ?? '')) continue;
        if (h.es_descuento || !h.incluido || !['unidades', 'cajas', 'abiertas', 'peso'].includes(String(h.entra_como ?? ''))) continue;
        const registrado = num(h.cantidad_stock);
        if (registrado == null || !(registrado > 0)) continue;
        t.renglones++;
        const fila = filaDeLectura(i);
        const leidoBien = cerca(num(fila.cantidad), registrado) && !(Number(fila.unidadesPorBulto) > 1);
        const candidatas = h.producto_id ? porProducto.get(h.producto_id) ?? [] : [];
        const f = delProv.get(claveArticulo(h.descripcion)) ?? (candidatas.length === 1 ? candidatas[0] : null);
        const etiqueta = `${String(h.fecha).slice(5)} ${String(nombre.get(h.proveedor_id) ?? '').slice(0, 18)} · ${String(h.descripcion).slice(0, 44)}`;
        {
          const propia = presentacionDeRenglon({ descripcion: h.descripcion, bultos: h.bultos, unidadesPorBulto: h.unidades_por_bulto, sueltas: h.sueltas, entraComo: h.entra_como, cantidadStock: h.cantidad_stock, importe: h.importe, incluido: h.incluido, esDescuento: h.es_descuento });
          const rp = propia ? cambiosDeFicha(fila, { ...propia, veces: 1, ultimaFactura: h.numero ?? null, ultimaFecha: h.fecha ?? null }, 1, esRenglonDescuento as any) : null;
          const finalP = rp && rp.cambios.length ? aplicarCambiosIA([fila], rp.cambios, esRenglonDescuento as any).items[0] : fila;
          const okP = !!rp && (rp.estado === 'aplicada' || rp.estado === 'ya_estaba') && cerca(num(finalP.cantidad), registrado);
          if (leidoBien) {
            prox.bien++;
            if (rp && rp.estado === 'aplicada' && !okP) { prox.bienRotos++; proxRotos.push(`${etiqueta} · estaba bien en ${fila.cantidad} y quedaría en ${finalP.cantidad}`); }
          } else {
            prox.corregidos++;
            if (okP) prox.resueltos++;
            else {
              const porque = !propia ? 'no deja ficha' : rp!.estado === 'no_aplica' ? 'la ficha no aplica' : rp!.estado === 'no_cierra' ? 'la cuenta no cierra con la ficha' : 'queda distinto';
              if (!propia) prox.sinFicha++; else if (rp!.estado === 'no_aplica') prox.noAplica++; else if (rp!.estado === 'no_cierra') prox.noCierra++; else prox.distinto++;
              proxFaltan.push(`${etiqueta} · leído ${fila.cantidad}${fila.porPeso ? ' kg' : ''}, registrado ${registrado} (${h.entra_como}; papel ${h.bultos ?? '—'} bultos × ${h.unidades_por_bulto ?? '—'} + ${h.sueltas ?? '—'}) · ${porque}`);
            }
          }
        }
        if (!f) {
          t.sinFicha++;
          if (!leidoBien) t.sinFichaMal++;
          if (firmaDe(fila)) {
            fm.sinDecidir++;
            sinDecidir.push({ proveedor: g0.proveedor_id, etiqueta, fila, registrado, descripcion: String(h.descripcion ?? '') });
            const previos = antecedentes.get(g0.proveedor_id) ?? [];
            const deForma = fichaDeForma(fila, formaDe(previos), String(nombre.get(h.proveedor_id) ?? ''));
            if (!deForma) { fm.noDecide++; formaFalta.push(`${etiqueta} · el proveedor todavía no mostró una sola manera (${previos.length} renglones anteriores)`); continue; }
            const rf = cambiosDeFicha(fila, deForma, 1, esRenglonDescuento as any);
            if (rf.estado !== 'aplicada') { fm.noCierra++; formaFalta.push(`${etiqueta} · la forma dice «${deForma.entraComo}» pero la cuenta no cierra`); continue; }
            const r0 = aplicarCambiosIA([fila], rf.cambios, esRenglonDescuento as any);
            const freno = frenarReglasAbsurdas([fila], r0.items, r0.registros);
            if (freno.frenados.length) { fm.frenadas++; formaFalta.push(`${etiqueta} · la forma lo dejaba lejos del costo del catálogo: quedó sin decidir`); continue; }
            const finalF = freno.items[0];
            if (cerca(num(finalF.cantidad), registrado)) { fm.bien++; formaBien.push(`${etiqueta} · leído ${fila.cantidad} sin decidir → ${finalF.cantidad} (${deForma.veces} artículos antes igual)`); }
            else { fm.mal++; formaMal.push(`${etiqueta} · la forma lo dejó en ${finalF.cantidad} y se registró ${registrado}`); }
          }
          continue;
        }
        t.conFicha++;
        const ficha: FichaArticulo = { ...f };
        const r = cambiosDeFicha(fila, ficha, 1, esRenglonDescuento as any);
        if (r.estado === 'no_cierra') { t.noCierra++; if (!leidoBien) faltaron.push(`${etiqueta} · la cuenta no cierra con la ficha (leído ${fila.cantidad}, registrado ${registrado})`); continue; }
        if (r.estado === 'no_aplica' || r.estado === 'sin_ficha') { t.noAplica++; if (!leidoBien) faltaron.push(`${etiqueta} · la ficha no aplica (leído ${fila.cantidad}, registrado ${registrado})`); continue; }
        const final = r.cambios.length ? aplicarCambiosIA([fila], r.cambios, esRenglonDescuento as any).items[0] : fila;
        const quedoBien = cerca(num(final.cantidad), registrado);
        if (quedoBien && leidoBien) t.yaEstaban++;
        else if (quedoBien) { t.arregladas++; arregladas.push(`${etiqueta} · leído ${fila.cantidad} → ${final.cantidad}${final.porPeso ? ' kg' : ''}`); }
        else if (leidoBien) { t.rotas++; rotas.push(`${etiqueta} · estaba bien en ${fila.cantidad} y la ficha lo dejó en ${final.cantidad} (registrado ${registrado})`); }
        else { t.noAlcanzo++; faltaron.push(`${etiqueta} · quedó ${final.cantidad}, se registró ${registrado}`); }
      }
    }
    // después de mirarla, se aprende de ella (igual que al registrar)
    if (items.length) {
      const lista = antecedentes.get(g0.proveedor_id) ?? [];
      antecedentes.set(g0.proveedor_id, lista);
      for (const h of grupo) {
        const i = items[Number(h.renglon) - 1];
        if (!i || String(i.descripcion ?? '') !== String(h.descripcion ?? '')) continue;
        // los más nuevos primero, como los devuelve la API
        lista.unshift({ leido: i, registrado: { descripcion: h.descripcion, bultos: h.bultos, unidadesPorBulto: h.unidades_por_bulto, sueltas: h.sueltas, entraComo: h.entra_como, cantidadStock: h.cantidad_stock, incluido: h.incluido, esDescuento: h.es_descuento } });
      }
    }
    const vistas = new Set<string>();
    for (const h of grupo) {
      const clave = claveArticulo(h.descripcion);
      const p = presentacionDeRenglon({ descripcion: h.descripcion, bultos: h.bultos, unidadesPorBulto: h.unidades_por_bulto, sueltas: h.sueltas, entraComo: h.entra_como, cantidadStock: h.cantidad_stock, importe: h.importe, incluido: h.incluido, esDescuento: h.es_descuento });
      if (!clave || !p || vistas.has(clave)) continue;
      vistas.add(clave);
      const previa = delProv.get(clave);
      const { presentacion, veces } = fichaTrasRegistro(previa ?? null, p);
      delProv.set(clave, { ...presentacion, veces, ultimaFactura: h.numero ?? null, ultimaFecha: h.fecha ?? null, productoId: h.producto_id ?? previa?.productoId ?? null });
    }
  }

  const fichas = [...memoria.values()].reduce((s, m) => s + m.size, 0);
  console.log(`\nREPASO DE LA FICHA DEL ARTÍCULO · ${new Date().toISOString().slice(0, 10)}`);
  console.log(`${t.facturas} facturas registradas (${t.conLectura} con su lectura guardada) · ${historial.length} renglones · quedan ${fichas} fichas de ${[...memoria.values()].filter((m) => m.size > 0).length} proveedores`);
  console.log(`\nRenglones de mercadería comparables: ${t.renglones}`);
  console.log(`  sin ficha todavía (primera vez del artículo): ${t.sinFicha} · de esos, ${t.sinFichaMal} necesitaron corrección`);
  console.log(`  con ficha: ${t.conFicha}`);
  console.log(`    la lectura ya venía bien y quedó igual: ${t.yaEstaban}`);
  console.log(`    venía mal y la ficha lo dejó como se registró: ${t.arregladas}`);
  console.log(`    venía mal y la ficha no alcanzó: ${t.noAlcanzo}`);
  console.log(`    la ficha no se aplicó (la cuenta no cierra): ${t.noCierra} · no aplica: ${t.noAplica}`);
  console.log(`    VENÍA BIEN Y LA FICHA LO DEJÓ MAL: ${t.rotas}`);
  if (arregladas.length) console.log(`\nArregladas por la ficha:\n${arregladas.map((x) => `  + ${x}`).join('\n')}`);
  if (faltaron.length) console.log(`\nSiguen necesitando a una persona:\n${faltaron.map((x) => `  · ${x}`).join('\n')}`);
  console.log(`\nLA PRÓXIMA VEZ que venga cada artículo, igual que vino:`);
  console.log(`  renglones que hubo que corregir: ${prox.corregidos} → entrarían solos ${prox.resueltos} · seguirían pidiendo a una persona ${prox.corregidos - prox.resueltos} (no deja ficha ${prox.sinFicha}, no aplica ${prox.noAplica}, la cuenta no cierra ${prox.noCierra}, queda distinto ${prox.distinto})`);
  console.log(`  renglones que la lectura traía bien: ${prox.bien} → la ficha dejaría mal ${prox.bienRotos}`);
  if (proxFaltan.length) console.log(`\nNo los resuelve la ficha:\n${proxFaltan.map((x) => `  · ${x}`).join('\n')}`);
  if (proxRotos.length) console.log(`\nLA FICHA LOS DEJARÍA MAL:\n${proxRotos.map((x) => `  ! ${x}`).join('\n')}`);
  if (rotas.length) console.log(`\nROTAS:\n${rotas.map((x) => `  ! ${x}`).join('\n')}`);
  console.log(`\nLA FORMA DEL PROVEEDOR (artículos que vienen por primera vez, con «×N» sin decidir): ${fm.sinDecidir}`);
  console.log(`  la forma los dejó como se registraron: ${fm.bien}`);
  console.log(`  LA FORMA LOS DEJÓ DISTINTO DE LO REGISTRADO: ${fm.mal}`);
  console.log(`  no decide (proveedor nuevo o contestó de las dos maneras): ${fm.noDecide} · la cuenta no cierra: ${fm.noCierra} · frenadas por el costo: ${fm.frenadas}`);
  if (formaBien.length) console.log(`\nResueltos por la forma:\n${formaBien.map((x) => `  + ${x}`).join('\n')}`);
  if (formaMal.length) console.log(`\nLA FORMA LOS DEJÓ MAL:\n${formaMal.map((x) => `  ! ${x}`).join('\n')}`);
  // LA PRÓXIMA VEZ: el mismo renglón, si viniera hoy como artículo nuevo, con lo
  // que el proveedor ya tiene registrado en todos sus OTROS artículos.
  const px = { bien: 0, mal: 0, noDecide: 0, noCierra: 0, frenadas: 0 };
  const pxMal: string[] = [];
  const pxNo = new Map<string, number>();
  for (const r of sinDecidir) {
    const otros = (antecedentes.get(r.proveedor) ?? []).filter((a) => String(a.registrado.descripcion ?? '') !== r.descripcion);
    const deForma = fichaDeForma(r.fila, formaDe(otros), String(nombre.get(r.proveedor) ?? ''));
    if (!deForma) { px.noDecide++; const n = String(nombre.get(r.proveedor) ?? ''); pxNo.set(n, (pxNo.get(n) ?? 0) + 1); continue; }
    const rf = cambiosDeFicha(r.fila, deForma, 1, esRenglonDescuento as any);
    if (rf.estado !== 'aplicada') { px.noCierra++; continue; }
    const r0 = aplicarCambiosIA([r.fila], rf.cambios, esRenglonDescuento as any);
    const freno = frenarReglasAbsurdas([r.fila], r0.items, r0.registros);
    if (freno.frenados.length) { px.frenadas++; continue; }
    if (cerca(num(freno.items[0].cantidad), r.registrado)) px.bien++;
    else { px.mal++; pxMal.push(`${r.etiqueta} · quedaría en ${freno.items[0].cantidad} y se registró ${r.registrado}`); }
  }
  console.log(`\nLA PRÓXIMA VEZ que cada proveedor traiga un artículo nuevo con «×N» (los mismos ${sinDecidir.length} renglones, contra sus otros artículos):`);
  console.log(`  entrarían solos y bien: ${px.bien} · QUEDARÍAN MAL: ${px.mal} · siguen sin decidir: ${px.noDecide + px.noCierra + px.frenadas} (no decide ${px.noDecide}, la cuenta no cierra ${px.noCierra}, frenadas por el costo ${px.frenadas})`);
  if (pxNo.size) console.log(`  proveedores que todavía no deciden: ${[...pxNo.entries()].map(([k, v]) => `${k.slice(0, 22)} (${v})`).join(' · ')}`);
  if (pxMal.length) console.log(`\nLA PRÓXIMA VEZ QUEDARÍAN MAL:\n${pxMal.map((x) => `  ! ${x}`).join('\n')}`);
  if (process.argv.includes('--detalle') && formaFalta.length) console.log(`\nSiguen sin decidir:\n${formaFalta.map((x) => `  · ${x}`).join('\n')}`);
  process.exit(rotas.length || proxRotos.length || formaMal.length || pxMal.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
