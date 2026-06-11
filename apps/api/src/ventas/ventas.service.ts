import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase.provider';

export type CrearVentaDto = {
  sucursalId: string;
  canal?: 'mostrador' | 'self_checkout' | 'web' | 'whatsapp' | 'pickup';
  items: { sku: string; cantidad: number }[];
  pagos: { medio: string; monto: number }[];
  clienteDni?: string;
  sesionCajaId?: string;
  usuarioId?: string;
  ventaId?: string; // idempotencia POS offline
};

@Injectable()
export class VentasService {
  constructor(@Inject(SUPABASE) private readonly db: SupabaseClient) {}

  async registrar(dto: CrearVentaDto) {
    const items = await Promise.all(
      (dto.items ?? []).map(async (i) => ({
        producto_id: await this.productoIdPorSku(i.sku),
        cantidad: Number(i.cantidad),
      })),
    );
    const { data, error } = await this.db.rpc('registrar_venta', {
      p_sucursal: dto.sucursalId,
      p_items: items,
      p_pagos: dto.pagos,
      p_canal: dto.canal ?? 'mostrador',
      p_cliente_dni: dto.clienteDni ?? null,
      p_sesion_caja: dto.sesionCajaId ?? null,
      p_usuario: dto.usuarioId ?? null,
      p_venta_id: dto.ventaId ?? null,
    });
    if (error) throw new BadRequestException(this.traducirError(error.message));
    return data;
  }

  async listar(limite = 30) {
    const { data, error } = await this.db
      .from('ventas')
      .select(
        `id, canal, estado, subtotal, descuento, total, vendida_en,
         sucursal:sucursales(nombre),
         cliente:clientes(dni, tipo),
         items:ventas_items(cantidad, precio_unitario, producto:productos(sku, nombre)),
         pagos(medio, monto)`,
      )
      .order('vendida_en', { ascending: false })
      .limit(Math.min(limite, 100));
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async resumenHoy() {
    const desde = new Date();
    desde.setHours(0, 0, 0, 0);
    const { data, error } = await this.db
      .from('ventas')
      .select('total, descuento, canal, sucursal:sucursales(nombre)')
      .eq('estado', 'completada')
      .gte('vendida_en', desde.toISOString());
    if (error) throw new BadRequestException(error.message);

    const ventas = (data ?? []) as any[];
    const facturado = ventas.reduce((s, v) => s + Number(v.total), 0);
    const descuentos = ventas.reduce((s, v) => s + Number(v.descuento), 0);
    const porSucursal: Record<string, { facturado: number; tickets: number }> = {};
    for (const v of ventas) {
      const suc = v.sucursal?.nombre ?? '—';
      porSucursal[suc] ??= { facturado: 0, tickets: 0 };
      porSucursal[suc].facturado += Number(v.total);
      porSucursal[suc].tickets += 1;
    }
    return {
      tickets: ventas.length,
      facturado,
      descuentos,
      ticketPromedio: ventas.length ? facturado / ventas.length : 0,
      porSucursal,
    };
  }

  // Anulación con devolución de stock y nota de crédito en cola ARCA
  async anular(ventaId: string, usuarioId?: string) {
    const { data: venta, error } = await this.db
      .from('ventas')
      .select('id, estado, total, sucursal_id, items:ventas_items(producto_id, cantidad), sucursal:sucursales(punto_venta_arca)')
      .eq('id', ventaId)
      .single();
    if (error || !venta) throw new BadRequestException('No existe la venta');
    if (venta.estado !== 'completada') {
      throw new BadRequestException(`La venta ya está ${venta.estado}`);
    }

    for (const item of (venta.items ?? []) as any[]) {
      const { error: errMov } = await this.db.rpc('registrar_movimiento', {
        p_producto_id: item.producto_id,
        p_sucursal_id: venta.sucursal_id,
        p_tipo: 'devolucion',
        p_cantidad: Number(item.cantidad),
        p_motivo: null,
        p_referencia_tipo: 'venta_anulada',
        p_referencia_id: ventaId,
        p_usuario_id: usuarioId ?? null,
      });
      if (errMov) throw new BadRequestException(errMov.message);
    }

    await this.db.from('ventas').update({ estado: 'anulada' }).eq('id', ventaId);
    await this.db.from('comprobantes_arca').insert({
      venta_id: ventaId,
      tipo: 'NCB',
      punto_venta: (venta as any).sucursal?.punto_venta_arca ?? 1,
      estado: 'pendiente',
    });
    return { anulada: true, total: Number(venta.total) };
  }

  // Lo que ve el cajero al pedir el DNI: categoría e historial resumido
  async clientePorDni(dni: string) {
    const { data: cliente, error } = await this.db
      .from('clientes')
      .select('id, dni, nombre, tipo, puntos, verificado')
      .eq('dni', dni.trim())
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!cliente) return { existe: false, dni: dni.trim() };

    const { data: ventas } = await this.db
      .from('ventas')
      .select('total')
      .eq('cliente_id', cliente.id)
      .eq('estado', 'completada');
    const compras = ventas?.length ?? 0;
    const gastado = (ventas ?? []).reduce((s, v) => s + Number(v.total), 0);
    return {
      existe: true,
      ...cliente,
      compras,
      ticketPromedio: compras ? Math.round(gastado / compras) : 0,
    };
  }

  private async productoIdPorSku(sku: string): Promise<string> {
    const { data, error } = await this.db
      .from('productos')
      .select('id')
      .eq('sku', sku)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new BadRequestException(`No existe el producto ${sku}`);
    return data.id;
  }

  private traducirError(mensaje: string): string {
    if (mensaje.includes('permission denied')) {
      return 'El backend no tiene permisos de escritura: falta la SUPABASE_SERVICE_KEY en apps/api/.env';
    }
    return mensaje;
  }
}
