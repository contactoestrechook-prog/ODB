import { BadRequestException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase.provider';

// Comprá Fácil: el cliente verificado escanea en el local y paga con Mercado Pago.
// La venta queda registrada al instante y el cliente sale mostrando un código
// que un empleado valida en la puerta (control anti-hurto).
@Injectable()
export class CompraFacilService {
  constructor(@Inject(SUPABASE) private readonly db: SupabaseClient) {}

  async comprar(dni: string, sucursalId: string, items: { sku: string; cantidad: number }[]) {
    if (!items?.length) throw new BadRequestException('El changuito está vacío');

    const { data: cliente } = await this.db
      .from('clientes')
      .select('id, tipo, verificado')
      .eq('dni', dni)
      .maybeSingle();
    if (!cliente?.verificado) {
      throw new ForbiddenException(
        'Comprá Fácil es solo para clientes con identidad verificada (DNI + rostro): verificate desde el inicio de la app',
      );
    }

    // precios con la misma lógica canónica de la base (segmento + medio MP)
    const renglones: { producto_id: string; cantidad: number }[] = [];
    let total = 0;
    for (const item of items) {
      const { data: prod } = await this.db
        .from('productos')
        .select('id')
        .eq('sku', item.sku)
        .maybeSingle();
      if (!prod) throw new BadRequestException(`No existe el producto ${item.sku}`);
      const { data: pv } = await this.db
        .rpc('precio_vigente', {
          p_producto_id: prod.id,
          p_fecha: new Date().toISOString(),
          p_segmento: cliente.tipo,
          p_medio_pago: 'mercadopago',
        })
        .maybeSingle();
      renglones.push({ producto_id: prod.id, cantidad: Number(item.cantidad) });
      total += Math.round(Number(item.cantidad) * Number((pv as any)?.precio_final ?? 0) * 100) / 100;
    }
    total = Math.round(total * 100) / 100;

    // TODO(mp): con MP_ACCESS_TOKEN, crear el pago real (Checkout API) y
    // registrar la venta recién cuando MP apruebe. Hoy: registro directo.
    const { data: venta, error } = await this.db.rpc('registrar_venta', {
      p_sucursal: sucursalId,
      p_items: renglones,
      p_pagos: [{ medio: 'mercadopago', monto: total }],
      p_canal: 'self_checkout',
      p_cliente_dni: dni,
    });
    if (error) throw new BadRequestException(error.message);

    // código de salida corto (vive en auditoría: sin cambios de esquema)
    const codigo = 'CF-' + Math.random().toString(36).slice(2, 8).toUpperCase();
    await this.db.from('auditoria').insert({
      accion: 'codigo_salida',
      entidad: 'venta',
      entidad_id: (venta as any).venta_id,
      datos_despues: { codigo },
    });

    return { ...(venta as any), codigoSalida: codigo };
  }

  // --- Control de salida (lado empleado) ---
  async buscarSalida(codigo: string) {
    const { data: registro } = await this.db
      .from('auditoria')
      .select('entidad_id')
      .eq('accion', 'codigo_salida')
      .filter('datos_despues->>codigo', 'eq', codigo.trim().toUpperCase())
      .maybeSingle();
    if (!registro) throw new BadRequestException('Código de salida inexistente');

    const [{ data: venta }, { data: validada }] = await Promise.all([
      this.db
        .from('ventas')
        .select(
          'id, total, vendida_en, estado, cliente:clientes(dni, tipo, verificado), items:ventas_items(cantidad, producto:productos(nombre))',
        )
        .eq('id', registro.entidad_id)
        .single(),
      this.db
        .from('auditoria')
        .select('id, creado_en, usuario:usuarios(nombre)')
        .eq('accion', 'salida_validada')
        .eq('entidad_id', registro.entidad_id)
        .maybeSingle(),
    ]);
    return { codigo: codigo.trim().toUpperCase(), venta, yaValidada: validada ?? null };
  }

  async validarSalida(codigo: string, usuarioId: string) {
    const { yaValidada, venta } = await this.buscarSalida(codigo);
    if (yaValidada) {
      throw new BadRequestException('Ese código YA fue validado: posible doble salida');
    }
    await this.db.from('auditoria').insert({
      accion: 'salida_validada',
      entidad: 'venta',
      entidad_id: (venta as any).id,
      usuario_id: usuarioId,
    });
    return { validada: true };
  }
}
