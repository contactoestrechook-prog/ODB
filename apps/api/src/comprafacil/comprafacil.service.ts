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
    const token = process.env.MERCADOPAGO_ACCESS_TOKEN;
    if (!token) {
      throw new BadRequestException('Comprá Fácil necesita Mercado Pago configurado (MERCADOPAGO_ACCESS_TOKEN) para cobrar');
    }

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
    const mpItems: any[] = [];
    let total = 0;
    for (const item of items) {
      const { data: prod } = await this.db
        .from('productos')
        .select('id, nombre')
        .eq('sku', item.sku)
        .maybeSingle();
      if (!prod) throw new BadRequestException(`No existe el producto ${item.sku}`);
      let { data: pv, error: errPv } = await this.db
        .rpc('precio_vigente', { p_producto_id: prod.id, p_fecha: new Date().toISOString(), p_segmento: cliente.tipo, p_medio_pago: 'mercadopago', p_verificado: true })
        .maybeSingle();
      if (errPv) {
        ({ data: pv } = await this.db
          .rpc('precio_vigente', { p_producto_id: prod.id, p_fecha: new Date().toISOString(), p_segmento: cliente.tipo, p_medio_pago: 'mercadopago' })
          .maybeSingle());
      }
      const unit = Math.round(Number((pv as any)?.precio_final ?? 0));
      const cant = Math.round(Number(item.cantidad)) || 1;
      renglones.push({ producto_id: prod.id, cantidad: cant });
      mpItems.push({ title: prod.nombre ?? 'Producto O.D.B', quantity: cant, unit_price: unit, currency_id: 'ARS' });
      total += unit * cant;
    }
    if (total <= 0) throw new BadRequestException('El changuito no tiene importes válidos para cobrar (revisá los precios)');

    // El changuito queda PENDIENTE; la venta y el código se emiten cuando MP aprueba.
    const { data: pend, error: e1 } = await this.db
      .from('compra_facil_pendientes')
      .insert({ cliente_dni: dni, sucursal_id: sucursalId, items: renglones, total })
      .select('id')
      .single();
    if (e1) throw new BadRequestException(e1.message);

    const base = process.env.API_PUBLIC_URL ?? 'https://odb-api-production.up.railway.app';
    const res = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        items: mpItems.filter((i) => i.unit_price > 0),
        external_reference: `CF-${pend.id}`,
        back_urls: { success: `${base}/pago/ok`, pending: `${base}/pago/ok`, failure: `${base}/pago/ok` },
        auto_return: 'approved',
        notification_url: `${base}/comprafacil/webhook`,
        statement_descriptor: 'O.D.B',
      }),
    });
    const d: any = await res.json();
    if (!res.ok) throw new BadRequestException(d?.message ?? 'No se pudo crear el pago en Mercado Pago');
    return { id: pend.id, total, url: d.init_point ?? d.sandbox_init_point };
  }

  // Confirma el pago: registra la venta y emite el código (idempotente).
  async confirmarPago(refId: string, mpPaymentId?: string) {
    const { data: pend } = await this.db.from('compra_facil_pendientes').select('*').eq('id', refId).maybeSingle();
    if (!pend || pend.estado === 'pagado') return { ok: true };
    const { data: venta, error } = await this.db.rpc('registrar_venta', {
      p_sucursal: pend.sucursal_id,
      p_items: pend.items,
      p_pagos: [{ medio: 'mercadopago', monto: Number(pend.total) }],
      p_canal: 'self_checkout',
      p_cliente_dni: pend.cliente_dni,
    });
    if (error) throw new BadRequestException(error.message);
    const codigo = 'CF-' + Math.random().toString(36).slice(2, 8).toUpperCase();
    await this.db.from('auditoria').insert({
      accion: 'codigo_salida', entidad: 'venta', entidad_id: (venta as any).venta_id, datos_despues: { codigo },
    });
    await this.db.from('compra_facil_pendientes').update({ estado: 'pagado', venta_id: (venta as any).venta_id, codigo }).eq('id', refId);
    // guarda el id del pago de MP para la conciliación automática posterior
    if (mpPaymentId) {
      await this.db.from('pagos').update({ mp_payment_id: String(mpPaymentId) })
        .eq('venta_id', (venta as any).venta_id).eq('medio', 'mercadopago');
    }
    return { ok: true };
  }

  async estadoPago(id: string) {
    const { data } = await this.db.from('compra_facil_pendientes').select('estado, total, codigo').eq('id', id).maybeSingle();
    if (!data) throw new BadRequestException('No existe la compra');
    return { estado: data.estado, total: Number(data.total), codigoSalida: data.codigo ?? null };
  }

  // Webhook de Mercado Pago para Comprá Fácil: re-consulta el pago (no confía en el POST).
  async webhookMP(rawBody: Buffer | undefined, query: any) {
    const token = process.env.MERCADOPAGO_ACCESS_TOKEN;
    if (!token) return { ok: true };
    let body: any = {};
    try { body = rawBody ? JSON.parse(rawBody.toString('utf8')) : {}; } catch {}
    const tipo = body?.type ?? query?.type ?? query?.topic;
    const pagoId = body?.data?.id ?? query?.['data.id'] ?? query?.id;
    if (tipo !== 'payment' || !pagoId) return { ok: true };
    try {
      const r = await fetch(`https://api.mercadopago.com/v1/payments/${pagoId}`, { headers: { Authorization: `Bearer ${token}` } });
      const pay: any = await r.json();
      if (pay?.status === 'approved' && typeof pay?.external_reference === 'string' && pay.external_reference.startsWith('CF-')) {
        await this.confirmarPago(pay.external_reference.slice(3), String(pagoId));
      }
    } catch {}
    return { ok: true };
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
