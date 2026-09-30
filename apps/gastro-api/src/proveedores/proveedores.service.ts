import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase.provider';

@Injectable()
export class ProveedoresService {
  constructor(@Inject(SUPABASE) private readonly db: SupabaseClient) {}

  async listar() {
    const { data, error } = await this.db.from('proveedores').select('*').order('nombre');
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async crear(nombre: string, cuit?: string) {
    const { data, error } = await this.db.from('proveedores').insert({ nombre, cuit: cuit ?? null }).select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  // Facturas/proformas con su detalle (si lo hay). El detalle es opcional a
  // propósito: no se adivinan montos de OCR de un ticket borroso, se cargan
  // cuando hay una fuente confiable (foto nítida o carga manual).
  async listarCompras() {
    const { data, error } = await this.db
      .from('compras')
      .select('*, proveedor:proveedores(nombre), items:compra_items(id, descripcion, cantidad, precio_unitario, total)')
      .order('fecha', { ascending: false });
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async crearCompra(input: {
    proveedorId: string;
    numeroComprobante?: string;
    fecha: string;
    subtotal?: number;
    iva105?: number;
    iva21?: number;
    total: number;
  }) {
    const { data, error } = await this.db
      .from('compras')
      .insert({
        proveedor_id: input.proveedorId,
        numero_comprobante: input.numeroComprobante ?? null,
        fecha: input.fecha,
        subtotal: input.subtotal ?? null,
        iva_105: input.iva105 ?? null,
        iva_21: input.iva21 ?? null,
        total: input.total,
      })
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  // El detector de "compras caras": compara el precio unitario de cada insumo
  // contra la compra anterior del mismo insumo (mismo texto de descripción).
  // Simple a propósito: la normalización fina llega cuando haya histórico real.
  async variaciones() {
    const { data, error } = await this.db
      .from('compra_items')
      .select('descripcion, precio_unitario, compra:compras(fecha, creado_en, proveedor:proveedores(nombre))')
      .not('precio_unitario', 'is', null)
      .order('descripcion');
    if (error) throw new BadRequestException(error.message);

    const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
    const porInsumo = new Map<string, any[]>();
    for (const it of data ?? []) {
      const clave = norm(it.descripcion);
      (porInsumo.get(clave) ?? porInsumo.set(clave, []).get(clave)!).push(it);
    }

    const resultado: any[] = [];
    for (const items of porInsumo.values()) {
      if (items.length < 2) continue;
      // desempate por fecha de carga: dos facturas del mismo día se ordenan
      // por cuál se registró primero en el sistema
      items.sort(
        (a, b) =>
          new Date(a.compra?.fecha).getTime() - new Date(b.compra?.fecha).getTime() ||
          new Date(a.compra?.creado_en).getTime() - new Date(b.compra?.creado_en).getTime(),
      );
      const anterior = items[items.length - 2];
      const ultimo = items[items.length - 1];
      const precioAnt = Number(anterior.precio_unitario);
      const precioUlt = Number(ultimo.precio_unitario);
      if (!precioAnt) continue;
      const variacionPct = Math.round(((precioUlt - precioAnt) / precioAnt) * 1000) / 10;
      resultado.push({
        descripcion: ultimo.descripcion,
        proveedor: ultimo.compra?.proveedor?.nombre ?? null,
        fechaAnterior: anterior.compra?.fecha,
        fechaUltima: ultimo.compra?.fecha,
        precioAnterior: precioAnt,
        precioUltimo: precioUlt,
        variacionPct,
      });
    }
    return resultado.sort((a, b) => b.variacionPct - a.variacionPct);
  }

  async eliminarItem(itemId: string) {
    const { error } = await this.db.from('compra_items').delete().eq('id', itemId);
    if (error) throw new BadRequestException(error.message);
    return { ok: true };
  }

  async agregarItem(compraId: string, input: { descripcion: string; cantidad?: number; precioUnitario?: number; total?: number }) {
    const { data, error } = await this.db
      .from('compra_items')
      .insert({
        compra_id: compraId,
        descripcion: input.descripcion,
        cantidad: input.cantidad ?? null,
        precio_unitario: input.precioUnitario ?? null,
        total: input.total ?? null,
      })
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }
}
