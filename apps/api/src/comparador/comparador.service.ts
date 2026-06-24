import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { SUPABASE } from '../supabase.provider';

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

const INSTRUCCION = `Esta es una lista de precios de un proveedor (bebidas y/o fiambrería y/o almacén) para un comercio. Extraé TODOS los renglones de PRODUCTOS.
Por cada producto: codigo (código del proveedor si aparece), descripcion (que EMPIECE por la marca cuando se vea, ej "Casa Boher Gran Malbec"), presentacion (ej "750cc", "6x750", "1.5 KG" si figura), y costo.
COSTO = el precio que el comercio PAGA por UNA unidad (botella/pieza), ya con bonificación/descuento e IVA incluido (columna "x BOT.", "x Unidad", "Final c/IVA" por unidad). NO uses: precio por CAJA; ni lista SIN bonificar; ni el precio SUGERIDO/"VENTA"/"público" (suele ser el último y más alto). Si solo hay precio por caja y sabés unidades por caja, dividí.
Devolvé el costo como TEXTO tal cual aparece, SIN $ (ej "166.600", "12.809,67"). Ignorá encabezados, secciones, totales y filas sin precio.`;

const parseNum = (s: any) => {
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
const normalizar = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/gi, '').toLowerCase();
const mismaMarca = (desc: string, nombre: string) => {
  const pal = normalizar(desc).split(/\s+/).filter((p) => p.length >= 3);
  return !pal.length || normalizar(nombre).includes(pal[0]);
};

type Archivo = { base64: string; mime: string; nombre?: string };

@Injectable()
export class ComparadorService {
  private readonly claude = new Anthropic();
  constructor(@Inject(SUPABASE) private readonly db: SupabaseClient) {}

  async comparar() {
    const { data, error } = await this.db.rpc('comparar_proveedores', { p_min: 2 });
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  // Directorio con estadísticas por proveedor (# productos, valor, términos).
  async directorio() {
    const { data: provs, error } = await this.db
      .from('proveedores')
      .select('id, razon_social, cuit, telefono, email, condicion_pago, descuento_efectivo, lead_time_dias, activo')
      .order('razon_social');
    if (error) throw new BadRequestException(error.message);
    // paginar: Supabase limita a 1000 filas por consulta y proveedor_productos tiene miles
    const agg: Record<string, { n: number }> = {};
    for (let f = 0; ; f += 1000) {
      const { data } = await this.db.from('proveedor_productos').select('proveedor_id').range(f, f + 999);
      for (const r of data ?? []) { (agg[r.proveedor_id] ||= { n: 0 }).n++; }
      if (!data || data.length < 1000) break;
    }
    return (provs ?? []).map((p) => ({ ...p, productos: agg[p.id]?.n ?? 0 }));
  }

  // Estadísticas globales + dependencia del proveedor principal.
  async stats() {
    const dir = await this.directorio();
    const totalLinks = dir.reduce((s, p: any) => s + p.productos, 0);
    const top = [...dir].sort((a: any, b: any) => b.productos - a.productos)[0] as any;
    const comparables = await this.comparar();
    const ahorro = (comparables ?? []).reduce((s: number, c: any) => s + (Number(c.ahorro) || 0), 0);
    return {
      proveedores: dir.length,
      activos: dir.filter((p: any) => p.activo).length,
      productosComparables: (comparables ?? []).length,
      ahorroPotencial: Math.round(ahorro),
      principal: top ? { nombre: top.razon_social, productos: top.productos } : null,
      dependenciaPct: totalLinks ? Math.round(((top?.productos ?? 0) / totalLinks) * 100) : 0,
    };
  }

  async proveedores() {
    const { data, error } = await this.db
      .from('proveedores')
      .select('id, razon_social, condicion_pago, descuento_efectivo, activo')
      .order('razon_social');
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async guardarTerminos(id: string, b: { condicionPago?: string; descuentoEfectivo?: number; leadTimeDias?: number; telefono?: string; email?: string; cuit?: string }) {
    const patch: any = {};
    if (b.condicionPago !== undefined) patch.condicion_pago = b.condicionPago || null;
    if (b.telefono !== undefined) patch.telefono = b.telefono || null;
    if (b.email !== undefined) patch.email = b.email || null;
    if (b.cuit !== undefined) patch.cuit = b.cuit || null;
    if (b.leadTimeDias !== undefined) patch.lead_time_dias = Number(b.leadTimeDias) || null;
    if (b.descuentoEfectivo !== undefined) {
      const d = Number(b.descuentoEfectivo);
      if (!Number.isFinite(d) || d < 0 || d > 100) throw new BadRequestException('Descuento inválido');
      patch.descuento_efectivo = d;
    }
    const { error } = await this.db.from('proveedores').update(patch).eq('id', id);
    if (error) throw new BadRequestException(error.message);
    return { ok: true };
  }

  // Extrae la lista (texto o archivo PDF/imagen) con IA y la deduplica.
  private async extraer(texto?: string, archivo?: Archivo) {
    const content: any[] = [];
    if (archivo?.base64) {
      const mt = archivo.mime || '';
      if (mt.includes('pdf')) content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: archivo.base64 } });
      else if (mt.startsWith('image/')) content.push({ type: 'image', source: { type: 'base64', media_type: mt, data: archivo.base64 } });
      else if (texto) content.push({ type: 'text', text: texto.slice(0, 120000) });
    } else if (texto) {
      content.push({ type: 'text', text: texto.slice(0, 120000) });
    }
    if (!content.length) throw new BadRequestException('Pegá el texto de la lista o subí un archivo (PDF/imagen).');
    content.push({ type: 'text', text: INSTRUCCION });
    const r = await this.claude.messages
      .stream({ model: 'claude-haiku-4-5', max_tokens: 32000, output_config: { format: { type: 'json_schema', schema: ESQUEMA } } as any, messages: [{ role: 'user', content }] })
      .finalMessage();
    const bloque = (r.content as any[]).find((b) => b.type === 'text');
    let items = (JSON.parse(bloque?.text ?? '{"items":[]}').items ?? [])
      .map((i: any) => ({ codigo: i.codigo ?? null, descripcion: i.descripcion, presentacion: i.presentacion ?? null, costo: parseNum(i.costo) }))
      .filter((i: any) => i.descripcion && i.costo > 0);
    const vistos = new Set<string>();
    items = items.filter((i: any) => { const k = (i.codigo ?? '') + '|' + i.descripcion; if (vistos.has(k)) return false; vistos.add(k); return true; });
    return items as { codigo: string | null; descripcion: string; presentacion: string | null; costo: number }[];
  }

  // Matchea contra el catálogo (guardián de marca).
  private async matchear(items: any[]) {
    const cola = [...items];
    await Promise.all(Array.from({ length: 8 }, async () => {
      while (cola.length) {
        const it = cola.shift();
        const { data: sim } = await this.db.rpc('buscar_producto_similar', { p_texto: it.descripcion }).maybeSingle();
        if (sim && (sim as any).similitud >= 0.42 && mismaMarca(it.descripcion, (sim as any).nombre)) {
          it.sku = (sim as any).sku; it.match = (sim as any).nombre;
        }
      }
    }));
    return items.filter((i) => i.sku);
  }

  // Analiza una lista nueva contra los proveedores YA cargados (sin escribir).
  async analizarLista(b: { proveedorNombre: string; markup?: number; descuentoEfectivo?: number; texto?: string; archivo?: Archivo }) {
    if (!b.proveedorNombre?.trim()) throw new BadRequestException('Indicá el nombre del proveedor.');
    const markup = Number(b.markup) || 1.6;
    const descEf = Math.min(Math.max(Number(b.descuentoEfectivo) || 0, 0), 100);
    const items = await this.extraer(b.texto, b.archivo);
    if (!items.length) throw new BadRequestException('No pude leer productos en la lista. Probá con otro archivo o pegá el texto.');
    const matched = await this.matchear(items);

    // costos actuales de otros proveedores para los productos matcheados
    const skus = [...new Set(matched.map((m) => m.sku))];
    const idBySku = new Map<string, { id: string; nombre: string }>();
    for (let k = 0; k < skus.length; k += 300) {
      const { data } = await this.db.from('productos').select('id, sku, nombre').in('sku', skus.slice(k, k + 300));
      (data ?? []).forEach((p) => idBySku.set(p.sku, { id: p.id, nombre: p.nombre }));
    }
    const ids = [...idBySku.values()].map((v) => v.id);
    const mejorOtro = new Map<string, { costo: number; prov: string }>();
    for (let k = 0; k < ids.length; k += 300) {
      const { data } = await this.db
        .from('proveedor_productos')
        .select('producto_id, ultimo_costo, proveedores(razon_social)')
        .in('producto_id', ids.slice(k, k + 300));
      for (const r of (data ?? []) as any[]) {
        const prov = r.proveedores?.razon_social ?? '';
        if (prov.toLowerCase() === b.proveedorNombre.trim().toLowerCase()) continue; // excluir el mismo
        const cur = mejorOtro.get(r.producto_id);
        if (!cur || Number(r.ultimo_costo) < cur.costo) mejorOtro.set(r.producto_id, { costo: Number(r.ultimo_costo), prov });
      }
    }

    let masBarato = 0, masCaro = 0, enComun = 0, ahorro = 0;
    const filas = matched.map((m) => {
      const info = idBySku.get(m.sku)!;
      const costoEf = Math.round(m.costo * (1 - descEf / 100) * 100) / 100;
      const otro = mejorOtro.get(info.id);
      let comparacion: any = { conComun: false };
      if (otro) {
        enComun++;
        const esBarato = costoEf < otro.costo;
        if (esBarato) { masBarato++; ahorro += otro.costo - costoEf; } else if (costoEf > otro.costo) masCaro++;
        comparacion = {
          conComun: true,
          costoOtro: Math.round(otro.costo), provOtro: otro.prov,
          esMasBarato: esBarato,
          diffPct: otro.costo ? Math.round(((costoEf - otro.costo) / otro.costo) * 100) : 0,
        };
      }
      return { descripcion: m.descripcion, match: info.nombre, sku: m.sku, costo: Math.round(m.costo), costoEfectivo: Math.round(costoEf), ...comparacion };
    });
    filas.sort((a, b2) => (a.conComun === b2.conComun ? 0 : a.conComun ? -1 : 1) || (a.diffPct ?? 0) - (b2.diffPct ?? 0));

    return {
      proveedorNombre: b.proveedorNombre.trim(), markup, descuentoEfectivo: descEf,
      extraidos: items.length, matcheados: matched.length,
      resumen: { enComun, masBarato, masCaro, ahorroPotencial: Math.round(ahorro) },
      items: filas,
      // payload para aplicar sin re-extraer
      paraAplicar: items.map((i: any) => ({ codigo: i.codigo, descripcion: i.descripcion, presentacion: i.presentacion, costo: i.costo, sku: i.sku ?? null })),
    };
  }

  // Aplica la lista: alta/actualización de proveedor + base + costos/precios a los matcheados.
  async aplicarLista(b: { proveedorNombre: string; markup?: number; descuentoEfectivo?: number; vigencia?: string; items: any[] }) {
    if (!b.proveedorNombre?.trim()) throw new BadRequestException('Indicá el nombre del proveedor.');
    if (!Array.isArray(b.items) || !b.items.length) throw new BadRequestException('Lista vacía.');
    const markup = Number(b.markup) || 1.6;
    let { data: prov } = await this.db.from('proveedores').select('id').eq('razon_social', b.proveedorNombre.trim()).maybeSingle();
    if (!prov) {
      const ins = await this.db.from('proveedores').insert({ razon_social: b.proveedorNombre.trim(), descuento_efectivo: Number(b.descuentoEfectivo) || 0 }).select('id').single();
      if (ins.error) throw new BadRequestException(ins.error.message);
      prov = ins.data;
    }
    await this.db.from('listas_proveedor').delete().eq('proveedor_id', prov!.id);
    const items = b.items.filter((i) => i.descripcion && Number(i.costo) > 0);
    const matched = items.filter((i) => i.sku);
    const { data: lista } = await this.db.from('listas_proveedor')
      .insert({ proveedor_id: prov!.id, archivo: 'admin', vigencia: b.vigencia || '', markup, items_total: items.length, items_match: matched.length })
      .select('id').single();
    const filas = items.map((i) => ({ lista_id: lista!.id, codigo: i.codigo ?? null, descripcion: i.descripcion, presentacion: i.presentacion ?? null, costo: Number(i.costo), precio_sugerido: Math.round(Number(i.costo) * markup * 100) / 100, producto_id: null, sku: i.sku ?? null }));
    for (let k = 0; k < filas.length; k += 300) await this.db.from('listas_proveedor_items').insert(filas.slice(k, k + 300));
    // un costo por sku (el más alto)
    const porSku = new Map<string, any>();
    for (const m of matched) { const prev = porSku.get(m.sku); const c = Number(m.costo); if (!prev || c > prev.costo) porSku.set(m.sku, { sku: m.sku, costo: c, precio: Math.round(c * markup * 100) / 100 }); }
    const aplicar = [...porSku.values()];
    let aplicados = 0;
    for (let k = 0; k < aplicar.length; k += 200) {
      const { data, error } = await this.db.rpc('aplicar_lista_con_precio', { p_proveedor: prov!.id, p_items: aplicar.slice(k, k + 200) });
      if (error) throw new BadRequestException(error.message);
      aplicados += (data as number) ?? 0;
    }
    return { ok: true, proveedorId: prov!.id, items: items.length, matcheados: matched.length, aplicados };
  }

  // Interpreta una aclaración dictada (voz→texto) sobre una bonificación/descuento
  // de un proveedor y calcula el factor que ajusta el COSTO efectivo.
  async interpretarAclaracion(b: { texto: string }) {
    if (!b.texto?.trim()) throw new BadRequestException('Dictá o escribí la aclaración.');
    const ESQ = {
      type: 'object',
      properties: {
        factorCosto: { type: 'number' },
        equivaleADescuentoPct: { type: 'number' },
        alcance: { type: 'string', enum: ['lista', 'producto'] },
        productoMencionado: { type: ['string', 'null'] },
        explicacion: { type: 'string' },
      },
      required: ['factorCosto', 'equivaleADescuentoPct', 'alcance', 'productoMencionado', 'explicacion'],
      additionalProperties: false,
    };
    const PROMPT = `Sos un asistente de compras de un comercio en Argentina. El comprador te dicta una ACLARACIÓN que le hizo un PROVEEDOR sobre una bonificación/descuento. Interpretala y calculá cómo afecta el COSTO efectivo por unidad.
Reglas de cálculo:
- "compro N y me regala M" / "N+M" / "por cada N lleva M de regalo" → recibís N+M por el precio de N → factorCosto = N/(N+M).
- "X% de descuento" o "X% pagando en efectivo/contado" → factorCosto = (100-X)/100.
- "2x1" → 0.5 ; "3x2" → 0.6667 ; "lleva 3 paga 2" → 0.6667.
- Si combina (ej. "6+2 y además 10% efectivo") → multiplicá los factores.
- Si NO afecta el costo (es solo un comentario), factorCosto = 1.
Si menciona un producto puntual, poné su nombre en productoMencionado y alcance="producto"; si aplica a toda la compra, alcance="lista" y productoMencionado=null.
factorCosto entre 0 y 1 (1 = sin cambio). equivaleADescuentoPct = round((1-factorCosto)*100). explicacion = una frase clara en español explicando la cuenta.`;
    const r = await this.claude.messages
      .stream({ model: 'claude-opus-4-8', max_tokens: 1024, output_config: { format: { type: 'json_schema', schema: ESQ } } as any, messages: [{ role: 'user', content: [{ type: 'text', text: `Aclaración del proveedor: "${b.texto.trim()}"` }, { type: 'text', text: PROMPT }] }] })
      .finalMessage();
    const bloque = (r.content as any[]).find((x) => x.type === 'text');
    const out = JSON.parse(bloque?.text ?? '{}');
    let f = Number(out.factorCosto);
    if (!Number.isFinite(f) || f <= 0 || f > 1) f = 1;
    return {
      factorCosto: Math.round(f * 1000) / 1000,
      equivaleADescuentoPct: Math.round((1 - f) * 100),
      alcance: out.alcance === 'producto' ? 'producto' : 'lista',
      productoMencionado: out.productoMencionado || null,
      explicacion: out.explicacion || '',
      texto: b.texto.trim(),
    };
  }
}
