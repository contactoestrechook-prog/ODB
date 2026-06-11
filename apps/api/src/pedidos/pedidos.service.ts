import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase.provider';

// Pipeline de pedidos externos (PedidosYa, web, pick-up).
// El canal real se codifica en el prefijo de la referencia (PY- / WEB- / PICKUP-)
// hasta aplicar db/migracion-pedidos.sql (suma 'pedidosya' al enum y funciones atómicas).

export type ItemPedidoYa = {
  sku?: string;
  name: string;
  quantity: number;
};

export type PedidoYaPayload = {
  orderId: string | number;
  customer?: { name?: string; dni?: string };
  items: ItemPedidoYa[];
  notes?: string;
};

const TRANSICIONES: Record<string, string[]> = {
  recibido: ['en_preparacion', 'cancelado'],
  pagado: ['en_preparacion', 'cancelado'],
  en_preparacion: ['listo', 'cancelado'],
  listo: ['entregado', 'cancelado'],
};

@Injectable()
export class PedidosService {
  constructor(@Inject(SUPABASE) private readonly db: SupabaseClient) {}

  // --- Recepción desde PedidosYa (webhook o simulador) ---
  async recibirDePedidosYa(payload: PedidoYaPayload) {
    const referencia = `PY-${payload.orderId}`;
    const { data: existente } = await this.db
      .from('pedidos')
      .select('id')
      .eq('qr_retiro', referencia)
      .maybeSingle();
    if (existente) return { pedidoId: existente.id, duplicado: true };

    // matching de renglones contra el catálogo
    const items: { producto_id: string; cantidad: number }[] = [];
    const sinMatch: string[] = [];
    for (const item of payload.items ?? []) {
      let productoId: string | null = null;
      if (item.sku) {
        const { data } = await this.db
          .from('productos')
          .select('id')
          .eq('sku', item.sku)
          .maybeSingle();
        productoId = data?.id ?? null;
      }
      if (!productoId && item.name) {
        const { data } = await this.db
          .rpc('buscar_producto_similar', { p_texto: item.name })
          .maybeSingle();
        if (data) {
          const { data: prod } = await this.db
            .from('productos')
            .select('id')
            .eq('sku', (data as any).sku)
            .single();
          productoId = prod?.id ?? null;
        }
      }
      if (productoId) items.push({ producto_id: productoId, cantidad: Number(item.quantity) });
      else sinMatch.push(item.name);
    }
    if (!items.length) {
      throw new BadRequestException(
        `Ningún renglón del pedido matcheó con el catálogo: ${sinMatch.join(', ')}`,
      );
    }

    const { data: suc } = await this.db
      .from('sucursales')
      .select('id')
      .order('nombre')
      .limit(1)
      .single();

    const pedidoId = await this.crear({
      canal: 'web', // TODO(migracion-pedidos): 'pedidosya' cuando esté el enum
      sucursalId: suc!.id,
      items,
      clienteDni: payload.customer?.dni,
      referencia,
      notas: [payload.customer?.name, payload.notes, sinMatch.length ? `SIN MATCHEAR: ${sinMatch.join(', ')}` : null]
        .filter(Boolean)
        .join(' · '),
    });
    return { pedidoId, renglones: items.length, sinMatch };
  }

  // --- Núcleo: crear pedido con reserva de stock ---
  async crear(p: {
    canal: string;
    sucursalId: string;
    items: { producto_id: string; cantidad: number }[];
    clienteDni?: string;
    referencia?: string;
    notas?: string;
  }) {
    let clienteId: string | null = null;
    if (p.clienteDni?.trim()) {
      const dni = p.clienteDni.trim();
      const { data } = await this.db.from('clientes').select('id').eq('dni', dni).maybeSingle();
      clienteId =
        data?.id ??
        (await this.db.from('clientes').insert({ dni }).select('id').single()).data?.id ??
        null;
    }

    const { data: precios } = await this.db.rpc('catalogo_precios', {
      p_ids: p.items.map((i) => i.producto_id),
    });
    const precioPor = new Map((precios ?? []).map((r: any) => [r.producto_id, Number(r.precio_final)]));

    const { data: pedido, error } = await this.db
      .from('pedidos')
      .insert({
        canal: p.canal,
        sucursal_id: p.sucursalId,
        cliente_id: clienteId,
        estado: 'recibido',
        total: 0,
        qr_retiro: p.referencia ?? null,
      })
      .select('id')
      .single();
    if (error) throw new BadRequestException(error.message);

    let total = 0;
    for (const item of p.items) {
      const precio = precioPor.get(item.producto_id) ?? 0;
      await this.db.from('pedidos_items').insert({
        pedido_id: pedido.id,
        producto_id: item.producto_id,
        cantidad: item.cantidad,
        precio_unitario: precio,
      });
      total += Math.round(item.cantidad * precio * 100) / 100;
      const { error: errMov } = await this.db.rpc('registrar_movimiento', {
        p_producto_id: item.producto_id,
        p_sucursal_id: p.sucursalId,
        p_tipo: 'reserva',
        p_cantidad: -item.cantidad,
        p_referencia_tipo: 'pedido',
        p_referencia_id: pedido.id,
      });
      if (errMov) {
        await this.db.from('pedidos').update({ estado: 'cancelado' }).eq('id', pedido.id);
        throw new BadRequestException(`Sin stock disponible: ${errMov.message}`);
      }
    }
    await this.db.from('pedidos').update({ total }).eq('id', pedido.id);
    return pedido.id;
  }

  // --- Cola del depósito ---
  async cola() {
    const { data, error } = await this.db
      .from('pedidos')
      .select(
        `id, canal, estado, total, qr_retiro, creado_en, listo_en,
         sucursal:sucursales(nombre),
         cliente:clientes(dni, tipo),
         items:pedidos_items(cantidad, precio_unitario, producto:productos(sku, nombre))`,
      )
      .in('estado', ['recibido', 'pagado', 'en_preparacion', 'listo'])
      .order('creado_en');
    if (error) throw new BadRequestException(error.message);
    return (data ?? []).map((p: any) => ({
      ...p,
      origen: p.qr_retiro?.startsWith('PY-')
        ? 'pedidosya'
        : p.qr_retiro?.startsWith('WEB-')
          ? 'web'
          : p.canal,
      minutos: Math.round((Date.now() - new Date(p.creado_en).getTime()) / 60000),
    }));
  }

  // --- Avance de estados (al entregar: libera reserva y registra la venta) ---
  async avanzar(pedidoId: string, estado: string, usuarioId?: string) {
    const { data: pedido, error } = await this.db
      .from('pedidos')
      .select('*, items:pedidos_items(producto_id, cantidad), cliente:clientes(dni, tipo)')
      .eq('id', pedidoId)
      .single();
    if (error || !pedido) throw new BadRequestException('No existe el pedido');
    if (!TRANSICIONES[pedido.estado]?.includes(estado)) {
      throw new BadRequestException(`Transición inválida: ${pedido.estado} → ${estado}`);
    }

    if (estado === 'entregado' || estado === 'cancelado') {
      for (const item of pedido.items as any[]) {
        const { error: errMov } = await this.db.rpc('registrar_movimiento', {
          p_producto_id: item.producto_id,
          p_sucursal_id: pedido.sucursal_id,
          p_tipo: 'liberacion_reserva',
          p_cantidad: Number(item.cantidad),
          p_referencia_tipo: 'pedido',
          p_referencia_id: pedidoId,
          p_usuario_id: usuarioId ?? null,
        });
        if (errMov) throw new BadRequestException(errMov.message);
      }
    }

    let venta: any = null;
    if (estado === 'entregado') {
      const esPY = pedido.qr_retiro?.startsWith('PY-');
      const medio = esPY ? 'pedidosya' : 'mercadopago';
      // mismo cálculo que hará registrar_venta (segmento + medio) para que el pago cierre exacto
      let monto = 0;
      for (const item of pedido.items as any[]) {
        const { data: pv } = await this.db
          .rpc('precio_vigente', {
            p_producto_id: item.producto_id,
            p_fecha: new Date().toISOString(),
            p_segmento: pedido.cliente?.tipo ?? null,
            p_medio_pago: medio,
          })
          .maybeSingle();
        monto += Math.round(Number(item.cantidad) * Number((pv as any)?.precio_final ?? 0) * 100) / 100;
      }
      const { data, error: errVenta } = await this.db.rpc('registrar_venta', {
        p_sucursal: pedido.sucursal_id,
        p_items: (pedido.items as any[]).map((i) => ({
          producto_id: i.producto_id,
          cantidad: Number(i.cantidad),
        })),
        p_pagos: [{ medio, monto: Math.round(monto * 100) / 100 }],
        p_canal: pedido.canal,
        p_cliente_dni: pedido.cliente?.dni ?? null,
        p_usuario: usuarioId ?? null,
      });
      if (errVenta) throw new BadRequestException(errVenta.message);
      venta = data;
    }

    await this.db
      .from('pedidos')
      .update({
        estado,
        listo_en: estado === 'listo' ? new Date().toISOString() : pedido.listo_en,
        entregado_en: estado === 'entregado' ? new Date().toISOString() : null,
      })
      .eq('id', pedidoId);

    return { estado, venta };
  }
}
