import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase.provider';
import { enLotes, traerTodo } from '../comun/lotes';
import { claveArticulo, fichaTrasRegistro, mismaPresentacion, presentacionDeRenglon, type Presentacion, type RenglonRegistrado } from './ficha-articulo';

const UUID = /^[0-9a-f-]{36}$/i;
const num = (v: unknown): number | null => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

type FilaFicha = {
  proveedor_id: string; clave: string; descripcion: string; codigo_proveedor: string | null; producto_id: string | null;
  cuenta_en: 'bultos' | 'sueltas'; unidades_por_bulto: number | null; entra_como: Presentacion['entraComo']; entra_de: number | null;
  factor: number | null; por_unidad: number | null; costo_neto: number | null; veces: number; ultima_factura: string | null; ultima_fecha: string | null;
};

const presentacionDeFila = (f: FilaFicha): Presentacion & { veces: number } => ({
  cuentaEn: f.cuenta_en,
  unidadesPorBulto: num(f.unidades_por_bulto),
  entraComo: f.entra_como,
  entraDe: num(f.entra_de),
  factor: num(f.factor),
  porUnidad: num(f.por_unidad),
  costoNeto: num(f.costo_neto),
  veces: Number(f.veces) || 1,
});

/** Lo que recibe la pantalla por cada renglón: la ficha, y si se encontró por la descripción o por el producto. */
export type FichaParaPantalla = Presentacion & { veces: number; ultimaFactura: string | null; ultimaFecha: string | null; por: 'descripcion' | 'producto' };

type RenglonAprendido = RenglonRegistrado & { codigoProveedor?: string | null; productoId?: string | null };

/**
 * Un renglón ya registrado de un proveedor, con lo que el lector había leído de
 * él. Con esto la pantalla arma la FORMA DEL PROVEEDOR (17/11/2026,
 * apps/admin/app/lib/forma-proveedor.ts): cómo entran sus artículos que dicen
 * «×N», para decidir sola el artículo que viene por primera vez.
 */
export type AntecedenteForma = {
  leido: Record<string, unknown>;
  registrado: { descripcion: string | null; bultos: number | null; unidadesPorBulto: number | null; sueltas: number | null; entraComo: string | null; cantidadStock: number | null; incluido: boolean; esDescuento: boolean };
};
// del renglón leído, lo único que mira la forma (el vínculo con el catálogo no viaja)
const CAMPOS_LEIDOS = ['descripcion', 'cantidad', 'precio', 'importe', 'alicuotaIva', 'unidadesPorBulto', 'bultos', 'unidadesSueltas', 'bonificacionPct', 'unidadesDelCatalogo', 'interpretado', 'esDescuento', 'esDevolucion', 'devueltoAMano'] as const;
const CACHE_ANTECEDENTES_MS = 5 * 60_000;

// La ficha del artículo del proveedor (11/11/2026): ver ficha-articulo.ts.
@Injectable()
export class FichaArticuloService {
  private readonly log = new Logger(FichaArticuloService.name);
  constructor(@Inject(SUPABASE) private readonly db: SupabaseClient) {}

  // los antecedentes de un proveedor cambian solo cuando se registra una factura suya
  private readonly cacheAntecedentes = new Map<string, { en: number; lista: AntecedenteForma[] }>();

  /**
   * Los renglones con «×N» que el lector dejó sin decidir en las últimas
   * facturas registradas de este proveedor, cada uno con cómo terminó entrando.
   * Solo lee. Si algo falla devuelve una lista vacía: sin antecedentes la
   * factura queda como se leyó, igual que antes.
   */
  async antecedentes(proveedorId: string): Promise<AntecedenteForma[]> {
    const guardado = this.cacheAntecedentes.get(proveedorId);
    if (guardado && Date.now() - guardado.en < CACHE_ANTECEDENTES_MS) return guardado.lista;
    try {
      const { data: hist, error } = await this.db.from('compras_historial')
        .select('lectura_id, renglon, descripcion, bultos, unidades_por_bulto, sueltas, entra_como, cantidad_stock, incluido, es_descuento, creado_en')
        .eq('proveedor_id', proveedorId).not('lectura_id', 'is', null).eq('es_descuento', false)
        .order('creado_en', { ascending: false }).limit(800);
      if (error) throw new Error(error.message);
      const filas = (hist ?? []) as any[];
      // las 40 facturas más nuevas: alcanza para ver cómo escribe el papel este proveedor
      const ids = [...new Set(filas.map((h) => String(h.lectura_id)))].slice(0, 40);
      const lecturas = ids.length
        ? await enLotes<{ id: string; items: unknown }>(ids, (lote) => this.db.from('lecturas_comprobante').select('id, items:resultado->items').in('id', lote), 10)
        : [];
      const itemsDe = new Map(lecturas.map((l) => [l.id, Array.isArray(l.items) ? (l.items as any[]) : []]));
      const lista: AntecedenteForma[] = [];
      for (const h of filas) {
        const i = itemsDe.get(String(h.lectura_id))?.[Number(h.renglon) - 1];
        // el mismo renglón (por posición y descripción) y que el lector haya dejado sin decidir
        if (!i || String(i.descripcion ?? '') !== String(h.descripcion ?? '')) continue;
        if (!(Number(i?.interpretado?.unidadesPorBulto) > 1)) continue;
        const leido: Record<string, unknown> = {};
        for (const k of CAMPOS_LEIDOS) if (i[k] !== undefined) leido[k] = i[k];
        lista.push({
          leido,
          registrado: {
            descripcion: h.descripcion ?? null, bultos: num(h.bultos), unidadesPorBulto: num(h.unidades_por_bulto), sueltas: num(h.sueltas),
            entraComo: h.entra_como ?? null, cantidadStock: num(h.cantidad_stock), incluido: !!h.incluido, esDescuento: !!h.es_descuento,
          },
        });
        if (lista.length >= 200) break;
      }
      this.cacheAntecedentes.set(proveedorId, { en: Date.now(), lista });
      return lista;
    } catch (e) {
      this.log.warn(`antecedentes de ${proveedorId}: ${e instanceof Error ? e.message : e}`);
      return [];
    }
  }

  private async fichasDe(proveedorId: string): Promise<FilaFicha[]> {
    return traerTodo<FilaFicha>((d, h) => this.db.from('proveedor_articulos')
      .select('proveedor_id, clave, descripcion, codigo_proveedor, producto_id, cuenta_en, unidades_por_bulto, entra_como, entra_de, factor, por_unidad, costo_neto, veces, ultima_factura, ultima_fecha')
      .eq('proveedor_id', proveedorId).order('clave').range(d, h));
  }

  /**
   * Las fichas para los renglones de una factura recién leída, en el mismo
   * orden. Primero por la descripción del papel; si no, por el producto de la
   * casa, cuando ese proveedor tiene una sola ficha para ese producto.
   */
  async buscar(proveedorId: string, renglones: { descripcion?: string | null; sku?: string | null }[]): Promise<{ fichas: (FichaParaPantalla | null)[]; antecedentes: AntecedenteForma[] }> {
    if (!UUID.test(String(proveedorId))) throw new BadRequestException('Proveedor inválido');
    const lista = (Array.isArray(renglones) ? renglones : []).slice(0, 400);
    if (!lista.length) return { fichas: [], antecedentes: [] };
    const [filas, antecedentes] = await Promise.all([this.fichasDe(proveedorId), this.antecedentes(proveedorId)]);
    if (!filas.length) return { fichas: lista.map(() => null), antecedentes };
    const porClave = new Map(filas.map((f) => [f.clave, f]));
    const porProducto = new Map<string, FilaFicha[]>();
    for (const f of filas) if (f.producto_id) porProducto.set(f.producto_id, [...(porProducto.get(f.producto_id) ?? []), f]);
    const skus = [...new Set(lista.map((r) => String(r?.sku ?? '').trim()).filter(Boolean))];
    const prods = skus.length ? await enLotes<{ id: string; sku: string }>(skus, (lote) => this.db.from('productos').select('id, sku').in('sku', lote)) : [];
    const idDe = new Map(prods.map((p) => [p.sku, p.id]));
    const paraPantalla = (f: FilaFicha, por: FichaParaPantalla['por']): FichaParaPantalla => ({
      ...presentacionDeFila(f), ultimaFactura: f.ultima_factura, ultimaFecha: f.ultima_fecha, por,
    });
    return {
      antecedentes,
      fichas: lista.map((r) => {
        const directa = porClave.get(claveArticulo(r?.descripcion));
        if (directa) return paraPantalla(directa, 'descripcion');
        const pid = idDe.get(String(r?.sku ?? '').trim());
        const delProducto = pid ? porProducto.get(pid) ?? [] : [];
        return delProducto.length === 1 ? paraPantalla(delProducto[0], 'producto') : null;
      }),
    };
  }

  /**
   * Aprende de una factura que se acaba de registrar. No frena nada: si falla,
   * la factura ya quedó registrada y la ficha se aprende la próxima vez.
   */
  async aprender(proveedorId: string, renglones: RenglonAprendido[], de: { numero?: string | null; fecha?: string | null; lecturaId?: string | null; usuarioId?: string | null; origen?: string } = {}) {
    // se acaba de registrar una factura de este proveedor: sus antecedentes cambiaron
    this.cacheAntecedentes.delete(proveedorId);
    try {
      const previas = new Map((await this.fichasDe(proveedorId)).map((f) => [f.clave, f]));
      const nuevas = new Map<string, Record<string, unknown>>();
      for (const r of renglones ?? []) {
        const clave = claveArticulo(r?.descripcion);
        const p = presentacionDeRenglon(r);
        if (!clave || !p) continue;
        const previa = previas.get(clave);
        // el mismo artículo dos veces en una factura (con cargo y bonificado): cuenta una sola vez
        if (nuevas.has(clave)) continue;
        const { presentacion, veces } = fichaTrasRegistro(previa ? presentacionDeFila(previa) : null, p);
        // volver a registrar la misma factura no suma «veces»
        const mismaFactura = !!previa && !!de.numero && previa.ultima_factura === de.numero;
        nuevas.set(clave, {
          proveedor_id: proveedorId,
          clave,
          descripcion: String(r.descripcion ?? '').trim().slice(0, 300),
          codigo_proveedor: r.codigoProveedor ? String(r.codigoProveedor).trim().slice(0, 60) : previa?.codigo_proveedor ?? null,
          producto_id: r.productoId ?? previa?.producto_id ?? null,
          cuenta_en: presentacion.cuentaEn,
          unidades_por_bulto: presentacion.unidadesPorBulto,
          entra_como: presentacion.entraComo,
          entra_de: presentacion.entraDe,
          factor: presentacion.factor,
          por_unidad: presentacion.porUnidad,
          // un renglón sin cargo no dice cuánto cuesta: se conserva el costo que había
          costo_neto: presentacion.costoNeto ?? (previa && mismaPresentacion(presentacionDeFila(previa), presentacion) ? num(previa.costo_neto) : null),
          veces: mismaFactura ? Math.max(1, veces - 1) : veces,
          ultima_factura: de.numero ?? null,
          ultima_fecha: de.fecha ?? null,
          ultima_lectura: de.lecturaId && UUID.test(de.lecturaId) ? de.lecturaId : null,
          origen: de.origen ?? 'registro',
          actualizado_en: new Date().toISOString(),
          actualizado_por: de.usuarioId ?? null,
        });
      }
      if (!nuevas.size) return { aprendidas: 0 };
      const { error } = await this.db.from('proveedor_articulos').upsert([...nuevas.values()], { onConflict: 'proveedor_id,clave' });
      if (error) throw new Error(error.message);
      return { aprendidas: nuevas.size };
    } catch (e) {
      this.log.warn(`fichas de artículo de ${proveedorId}: ${e instanceof Error ? e.message : e}`);
      return { aprendidas: 0 };
    }
  }

  /**
   * Arma las fichas desde todo lo ya registrado (compras_historial), factura
   * por factura en orden de fecha, como si se hubieran ido aprendiendo. Se corre
   * una vez al publicar; volver a correrlo deja lo mismo.
   */
  async sembrar(): Promise<{ proveedores: number; renglones: number; fichas: number }> {
    const filas = await traerTodo<any>((d, h) => this.db.from('compras_historial')
      .select('proveedor_id, lectura_id, numero, fecha, renglon, producto_id, codigo_proveedor, descripcion, bultos, unidades_por_bulto, sueltas, entra_como, cantidad_stock, importe, incluido, es_descuento, creado_en')
      .order('fecha').order('creado_en').order('renglon').range(d, h));
    // por proveedor, y adentro por factura
    const porFactura = new Map<string, any[]>();
    for (const f of filas) {
      const k = `${f.proveedor_id}|${f.fecha}|${f.numero ?? f.lectura_id ?? f.creado_en}`;
      porFactura.set(k, [...(porFactura.get(k) ?? []), f]);
    }
    // la tabla se deriva entera de lo registrado: se arma de cero
    await this.db.from('proveedor_articulos').delete().not('id', 'is', null);
    let fichas = 0;
    const proveedores = new Set<string>();
    for (const grupo of porFactura.values()) {
      const g0 = grupo[0];
      const r = await this.aprender(g0.proveedor_id, grupo.map((f) => ({
        descripcion: f.descripcion, codigoProveedor: f.codigo_proveedor, productoId: f.producto_id,
        bultos: f.bultos, unidadesPorBulto: f.unidades_por_bulto, sueltas: f.sueltas,
        entraComo: f.entra_como, cantidadStock: f.cantidad_stock, importe: f.importe, incluido: f.incluido, esDescuento: f.es_descuento,
      })), { numero: g0.numero, fecha: g0.fecha, lecturaId: g0.lectura_id, origen: 'historial' });
      fichas += r.aprendidas;
      proveedores.add(g0.proveedor_id);
    }
    const { count } = await this.db.from('proveedor_articulos').select('id', { count: 'exact', head: true });
    this.log.log(`fichas sembradas: ${count ?? '?'} de ${filas.length} renglones de ${proveedores.size} proveedores`);
    return { proveedores: proveedores.size, renglones: filas.length, fichas: count ?? fichas };
  }
}
