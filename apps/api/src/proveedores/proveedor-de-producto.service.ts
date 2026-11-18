import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase.provider';
import { enLotes, traerTodo } from '../comun/lotes';
import { invalidarAbastecimiento } from '../abastecimiento/motor';
import { PANTALLAS, esUuid, mensajeReasignado, refValida, separarRefs, type ResultadoReasignar } from './proveedor-de-producto';

// CAMBIAR EL PROVEEDOR DE UN PRODUCTO DESDE CUALQUIER PANTALLA (18/11/2026).
// Leandro: «tenemos que poder cambiar un producto de proveedor desde cualquier
// lado, tiene que ser muy fácil reasignarlo».
//
// Todas las pantallas usan lo mismo (el botón «Proveedor: X · cambiar»,
// apps/admin/app/ui/CambiarProveedor.tsx):
// - actuales(): el proveedor de cada producto con la regla de Qué comprar (el
//   decidido manda; si no, el último que se lo vendió o el último vínculo);
// - reasignar(): lo hace la base en una transacción (reasignar_proveedor):
//   decidido, vínculo nuevo, vínculos viejos sin compra afuera, auditoría.
//   Después se invalida la lectura del motor: Qué comprar y los pedidos lo
//   toman en la próxima lectura, no en un minuto.

export type Actual = { productoId: string; sku: string; nombre: string; proveedor: { id: string; razonSocial: string; decidido: boolean } | null };

@Injectable()
export class ProveedorDeProductoService {
  constructor(@Inject(SUPABASE) private readonly db: SupabaseClient) {}

  /** El proveedor de hoy de cada producto (por id o por SKU), con la clave con la que se pidió. */
  async actuales(refs: unknown): Promise<Record<string, Actual>> {
    const { ids, skus } = separarRefs(refs);
    if (!ids.length && !skus.length) return {};
    const [porId, porSku] = await Promise.all([
      enLotes<any>(ids, (l) => this.db.from('productos').select('id, sku, nombre').in('id', l) as any),
      enLotes<any>(skus, (l) => this.db.from('productos').select('id, sku, nombre').in('sku', l) as any),
    ]);
    const productos = new Map<string, any>([...porId, ...porSku].map((p) => [p.id, p]));
    const actual = await this.proveedorActual([...productos.keys()]);
    const salida: Record<string, Actual> = {};
    for (const p of productos.values()) {
      const a = actual.get(p.id) ?? null;
      const fila: Actual = { productoId: p.id, sku: p.sku, nombre: p.nombre, proveedor: a };
      if (ids.includes(p.id)) salida[p.id] = fila;
      if (skus.includes(p.sku)) salida[p.sku] = fila;
    }
    return salida;
  }

  private async proveedorActual(ids: string[]) {
    // de a 500: la función devuelve una fila por producto y PostgREST corta en 1.000
    const filas = await enLotes<any>(ids, (l) => this.db.rpc('proveedor_actual', { p_ids: l }) as any, 500);
    return new Map<string, { id: string; razonSocial: string; decidido: boolean }>(
      filas.map((f) => [f.producto_id, { id: f.proveedor_id, razonSocial: f.razon_social, decidido: f.decidido === true }]),
    );
  }

  /** Los proveedores a los que se le puede pasar un producto (los activos). */
  async proveedores() {
    const { data, error } = await this.db.from('proveedores').select('id, razon_social, nombre_fantasia, cuit')
      .eq('activo', true).order('razon_social').range(0, 4999);
    if (error) throw new BadRequestException(error.message);
    return ((data ?? []) as any[]).map((p) => ({ id: p.id, razonSocial: p.razon_social, nombreFantasia: p.nombre_fantasia ?? null, cuit: p.cuit ?? null }));
  }

  /** Lo que trabaja un proveedor (su lista de productos), con el proveedor de hoy de cada uno. */
  async delProveedor(proveedorId: string) {
    if (!esUuid(proveedorId)) throw new BadRequestException('Proveedor inválido');
    const filas = await traerTodo<any>((desde, hasta) => this.db.from('proveedor_productos')
      .select('producto_id, codigo_proveedor, ultimo_costo, producto:productos!inner(id, sku, nombre, activo)')
      .eq('proveedor_id', proveedorId).eq('producto.activo', true).order('producto_id').range(desde, hasta) as any);
    const actual = await this.proveedorActual(filas.map((f) => f.producto_id));
    return filas
      .map((f) => ({
        productoId: f.producto_id, sku: f.producto?.sku, nombre: f.producto?.nombre,
        codigoProveedor: f.codigo_proveedor ?? null, ultimoCosto: f.ultimo_costo != null ? Number(f.ultimo_costo) : null,
        proveedor: actual.get(f.producto_id) ?? null,
      }))
      .sort((a, b) => String(a.nombre ?? '').localeCompare(String(b.nombre ?? ''), 'es'));
  }

  /** Pasar el producto a otro proveedor. */
  async reasignar(b: { producto?: unknown; proveedorId?: unknown; pantalla?: unknown }, usuarioId?: string | null) {
    const ref = refValida(b?.producto);
    if (!ref) throw new BadRequestException('Falta el producto');
    if (!esUuid(b?.proveedorId)) throw new BadRequestException('Elegí el proveedor');
    let productoId = ref;
    if (!esUuid(ref)) {
      const { data, error } = await this.db.from('productos').select('id').eq('sku', ref).maybeSingle();
      if (error) throw new BadRequestException(error.message);
      if (!data) throw new NotFoundException(`No existe el producto ${ref}`);
      productoId = (data as any).id;
    }
    const pantalla = PANTALLAS[String(b?.pantalla ?? '')] ?? 'Panel';
    const { data, error } = await this.db.rpc('reasignar_proveedor', {
      p_producto: productoId, p_proveedor: (b.proveedorId as string).toLowerCase(), p_usuario: usuarioId ?? null, p_pantalla: pantalla,
    });
    if (error) throw new BadRequestException(error.message);
    const r = data as ResultadoReasignar;
    if (!r.yaEstaba) invalidarAbastecimiento(); // Qué comprar y los pedidos lo toman en la próxima lectura
    return { ...r, mensaje: mensajeReasignado(r) };
  }
}
