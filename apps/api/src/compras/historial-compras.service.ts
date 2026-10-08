import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase.provider';
import { enLotes, traerTodo } from '../comun/lotes';
import { filtrarPorBusqueda } from '../comun/busqueda';
import { codigoDeLaCasa, precioNeto, resumirProveedor, type DatosProducto, type RenglonHistorial, type VinculoProveedor } from './historial-compras';

const UUID = /^[0-9a-f-]{36}$/i;
const num = (v: unknown): number | null => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const texto = (v: unknown, max = 300) => (v == null ? null : String(v).trim().slice(0, max) || null);

// Lo que manda la pantalla de compras al registrar, por cada renglón de la factura.
type RenglonEntrante = {
  renglon?: number; sku?: string | null; codigoProveedor?: string | null; descripcion?: string;
  bultos?: number | null; unidadesPorBulto?: number | null; sueltas?: number | null; unidades?: number | null;
  precio?: number | null; bonificacionPct?: number | null; alicuotaIva?: number | null; importe?: number | null;
  entraComo?: string | null; cantidadStock?: number | null; costoUnitario?: number | null;
  incluido?: boolean; esDescuento?: boolean;
};

// Lo que nos vende cada proveedor (8/10/2026): ver historial-compras.ts.
@Injectable()
export class HistorialComprasService {
  private readonly log = new Logger(HistorialComprasService.name);
  constructor(@Inject(SUPABASE) private readonly db: SupabaseClient) {}

  /**
   * Guarda TODOS los renglones de una factura registrada, también los que no se
   * vincularon. Volver a registrar la misma factura reemplaza sus renglones.
   */
  async guardar(lecturaId: string | null, b: { proveedorId?: string; numero?: string; fecha?: string; renglones?: RenglonEntrante[] }, usuarioId?: string) {
    if (!b?.proveedorId || !UUID.test(b.proveedorId)) throw new BadRequestException('Falta el proveedor');
    const renglones = (Array.isArray(b.renglones) ? b.renglones : []).slice(0, 400).filter((r) => texto(r?.descripcion));
    if (!renglones.length) return { ok: true, guardados: 0 };
    const numero = texto(b.numero, 60);
    const fecha = /^\d{4}-\d{2}-\d{2}$/.test(String(b.fecha ?? '')) ? String(b.fecha) : new Date().toISOString().slice(0, 10);

    const skus = [...new Set(renglones.map((r) => texto(r.sku, 40)).filter(Boolean) as string[])];
    const prods = await enLotes<{ id: string; sku: string }>(skus, (lote) => this.db.from('productos').select('id, sku').in('sku', lote));
    const idDe = new Map(prods.map((p) => [p.sku, p.id]));
    const { data: fac } = numero
      ? await this.db.from('facturas_proveedor').select('id').eq('proveedor_id', b.proveedorId).eq('numero', numero).order('creado_en', { ascending: false }).limit(1).maybeSingle()
      : { data: null };

    const filas = renglones.map((r, k) => {
      const sku = texto(r.sku, 40);
      return {
        proveedor_id: b.proveedorId,
        lectura_id: lecturaId && UUID.test(lecturaId) ? lecturaId : null,
        factura_id: (fac as any)?.id ?? null,
        numero,
        fecha,
        renglon: Math.round(num(r.renglon) ?? k + 1),
        producto_id: sku ? idDe.get(sku) ?? null : null,
        codigo_proveedor: texto(r.codigoProveedor, 60),
        descripcion: texto(r.descripcion)!,
        bultos: num(r.bultos), unidades_por_bulto: num(r.unidadesPorBulto), sueltas: num(r.sueltas), unidades: num(r.unidades),
        precio: num(r.precio), bonificacion_pct: num(r.bonificacionPct), alicuota_iva: num(r.alicuotaIva), importe: num(r.importe),
        entra_como: texto(r.entraComo, 20), cantidad_stock: num(r.cantidadStock), costo_unitario: num(r.costoUnitario),
        incluido: !!r.incluido, es_descuento: !!r.esDescuento,
        origen: 'foto',
        usuario_id: usuarioId ?? null,
      };
    });
    const { error } = numero
      ? await this.db.from('compras_historial').upsert(filas, { onConflict: 'proveedor_id,numero,renglon' })
      : await this.db.from('compras_historial').insert(filas);
    if (error) throw new BadRequestException(error.message);

    // El código del proveedor queda en el vínculo SOLO si no había uno: el de su
    // lista de precios es más confiable que un dígito leído de una foto.
    const conCodigo = filas.filter((f) => f.producto_id && f.codigo_proveedor && !f.es_descuento);
    if (conCodigo.length) {
      const previos = await enLotes<{ producto_id: string; codigo_proveedor: string | null }>(conCodigo.map((f) => f.producto_id!), (lote) =>
        this.db.from('proveedor_productos').select('producto_id, codigo_proveedor').eq('proveedor_id', b.proveedorId!).in('producto_id', lote));
      const tenia = new Map(previos.map((p) => [p.producto_id, p.codigo_proveedor]));
      const nuevos = conCodigo
        .filter((f) => !tenia.get(f.producto_id!))
        .map((f) => ({ proveedor_id: b.proveedorId, producto_id: f.producto_id, codigo_proveedor: f.codigo_proveedor, actualizado_en: new Date().toISOString() }));
      const unicos = [...new Map(nuevos.map((n) => [n.producto_id, n])).values()];
      if (unicos.length) await this.db.from('proveedor_productos').upsert(unicos, { onConflict: 'proveedor_id,producto_id' }).then(({ error: e }) => e && this.log.warn(`código del proveedor: ${e.message}`));
    }
    return { ok: true, guardados: filas.length };
  }

  /** Lo que nos vende un proveedor: productos, precios, frecuencia, y lo que vino sin vincular. */
  async resumen(proveedorId: string) {
    if (!UUID.test(String(proveedorId))) throw new BadRequestException('Proveedor inválido');
    const { data: prov } = await this.db.from('proveedores').select('id, razon_social, lead_time_dias, condicion_pago').eq('id', proveedorId).maybeSingle();
    if (!prov) throw new BadRequestException('No existe el proveedor');
    const [renglones, vinculos] = await Promise.all([
      traerTodo<RenglonHistorial>((d, h) => this.db.from('compras_historial')
        .select('producto_id, numero, fecha, codigo_proveedor, descripcion, unidades_por_bulto, unidades, precio, bonificacion_pct, importe, costo_unitario, es_descuento')
        .eq('proveedor_id', proveedorId).order('fecha', { ascending: false }).order('renglon').range(d, h)),
      traerTodo<VinculoProveedor>((d, h) => this.db.from('proveedor_productos')
        .select('producto_id, codigo_proveedor, ultimo_costo, actualizado_en').eq('proveedor_id', proveedorId).order('producto_id').range(d, h)),
    ]);
    const ids = [...new Set([...renglones.map((r) => r.producto_id), ...vinculos.map((v) => v.producto_id)].filter(Boolean) as string[])];
    const prods = await enLotes<DatosProducto>(ids, (lote) => this.db.from('productos').select('id, sku, nombre, plu, codigo_legacy').in('id', lote));
    const resumen = resumirProveedor(renglones, vinculos, new Map(prods.map((p) => [p.id, p])));
    return { proveedor: { id: prov.id, nombre: (prov as any).razon_social, leadTimeDias: (prov as any).lead_time_dias ?? null, condicionPago: (prov as any).condicion_pago ?? null }, ...resumen };
  }

  /** Quién nos vendió este producto y a cuánto: para comparar una oferta contra lo que ya se pagó. */
  async porProducto(sku: string) {
    const { data: p } = await this.db.from('productos').select('id, sku, nombre, plu, codigo_legacy').eq('sku', String(sku ?? '').trim()).maybeSingle();
    if (!p) return { error: `No existe el producto ${sku}` };
    const { data } = await this.db.from('compras_historial')
      .select('proveedor_id, numero, fecha, precio, bonificacion_pct, unidades, costo_unitario, proveedor:proveedores(razon_social)')
      .eq('producto_id', (p as any).id).eq('es_descuento', false).order('fecha', { ascending: false }).limit(200);
    const porProv = new Map<string, any>();
    for (const r of (data ?? []) as any[]) {
      const x = porProv.get(r.proveedor_id) ?? porProv.set(r.proveedor_id, { proveedor: r.proveedor?.razon_social ?? '—', compras: new Set<string>(), ultimaCompra: r.fecha, ultimoPrecio: precioNeto(r), bonificacionPct: num(r.bonificacion_pct), costoUnitario: num(r.costo_unitario), unidades: 0, precios: [] as { fecha: string; precio: number | null }[] }).get(r.proveedor_id);
      x.compras.add(`${r.numero ?? ''}|${r.fecha}`);
      x.unidades += num(r.unidades) ?? 0;
      if (x.precios.length < 6) x.precios.push({ fecha: r.fecha, precio: precioNeto(r) });
    }
    return {
      sku: (p as any).sku, codigo: codigoDeLaCasa(p as any), nombre: (p as any).nombre,
      proveedores: [...porProv.values()].map((x) => ({ ...x, compras: x.compras.size })),
    };
  }

  /** Para el Analista: el proveedor por nombre (o por id). */
  async buscarProveedor(q: string) {
    if (UUID.test(String(q))) return this.resumen(String(q));
    const { data } = await this.db.from('proveedores').select('id, razon_social').eq('activo', true);
    const hallados = filtrarPorBusqueda((data ?? []) as any[], q, (p) => p.razon_social);
    if (!hallados.length) return { error: `No encontré un proveedor que se llame «${q}».` };
    if (hallados.length > 1 && !hallados.some((p) => String(p.razon_social).toLowerCase() === String(q).toLowerCase())) {
      return { varios: hallados.slice(0, 8).map((p) => p.razon_social), nota: 'Hay varios: preguntá cuál o usá el nombre completo.' };
    }
    return this.resumen(hallados[0].id);
  }
}
