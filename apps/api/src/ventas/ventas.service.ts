import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase.provider';
import { FacturacionService } from '../facturacion/facturacion.service';
import { CajaService } from '../caja/caja.service';

export type CrearVentaDto = {
  sucursalId: string;
  canal?: 'mostrador' | 'self_checkout' | 'web' | 'whatsapp' | 'pickup';
  items: { sku: string; cantidad: number }[];
  pagos: { medio: string; monto: number }[];
  clienteDni?: string;
  sesionCajaId?: string;
  usuarioId?: string;
  ventaId?: string; // idempotencia POS offline
  // comprobante fiscal a emitir junto con la venta (A/B/R). Sin él, la venta
  // queda solo en la cola ARCA como FB (comportamiento histórico).
  comprobante?: 'A' | 'B' | 'R';
  // para Factura A: CUIT y razón social del receptor (si el cliente no los tiene cargados)
  receptor?: { nombre?: string; docNumero?: string; condicionIva?: string };
  // descuento manual del ticket, autorizado con PIN de supervisor (auditado en la base)
  descuentoExtra?: number;
  // resuelto server-side: por el propio gerente/dueño autenticado (VentasController)
  // o consumiendo autorizacionToken (cajero) — nunca confiar en un valor del cliente.
  autorizadoPor?: string;
  autorizacionToken?: string;
  // venta a precio mayorista (lista Mayorista). El cliente marcado mayorista lo fuerza igual.
  mayorista?: boolean;
};

export type DevolverDto = {
  items: { sku: string; cantidad: number }[];
  reintegro?: 'efectivo' | 'otro'; // efectivo = registra egreso en la sesión de caja
  sesionCajaId?: string;
  autorizadoPor?: string;
  autorizacionToken?: string;
  usuarioId?: string;
};

@Injectable()
export class VentasService {
  private readonly log = new Logger(VentasService.name);

  constructor(
    @Inject(SUPABASE) private readonly db: SupabaseClient,
    private readonly facturacion: FacturacionService,
    private readonly caja: CajaService,
  ) {}

  async registrar(dto: CrearVentaDto) {
    // Si la venta entra por una caja abierta, la sucursal SIEMPRE se deriva de
    // la sesión (no del sucursalId que manda el cliente): así no se puede
    // cobrar en la caja de una sucursal y descontar stock de la otra. Además
    // valida que la sesión exista y esté abierta.
    let sucursalId = dto.sucursalId;
    if (dto.sesionCajaId) {
      const { data: sesion } = await this.db
        .from('sesiones_caja')
        .select('cerrada_en, caja:cajas(sucursal_id)')
        .eq('id', dto.sesionCajaId)
        .maybeSingle();
      if (!sesion) throw new BadRequestException('No existe la sesión de caja');
      if (sesion.cerrada_en) throw new BadRequestException('La sesión de caja está cerrada');
      const sucursalSesion = (sesion.caja as any)?.sucursal_id;
      if (sucursalSesion && dto.sucursalId && sucursalSesion !== dto.sucursalId) {
        throw new BadRequestException('La caja abierta pertenece a otra sucursal');
      }
      sucursalId = sucursalSesion ?? dto.sucursalId;
    }

    const items = await Promise.all(
      (dto.items ?? []).map(async (i) => ({
        producto_id: await this.productoIdPorSku(i.sku),
        cantidad: Number(i.cantidad),
      })),
    );

    // Cta cte: validar ANTES de registrar la venta (si el límite no alcanza,
    // la venta no debe existir — evita ventas cobradas "a cuenta" sin asiento).
    const montoCtaCte = (dto.pagos ?? [])
      .filter((p) => p.medio === 'cta_cte')
      .reduce((s, p) => s + Number(p.monto), 0);
    if (montoCtaCte > 0) await this.validarCtaCte(dto.clienteDni, montoCtaCte);

    // Autorización de supervisor (PIN de un solo uso): habilita tanto el
    // descuento manual como forzar una venta por debajo del costo (liquidación
    // real). Si no vino ya autorizado por el propio gerente/dueño, se consume
    // el token cuando esté presente.
    let autorizadoPor = dto.autorizadoPor;
    if (!autorizadoPor && dto.autorizacionToken) {
      const auth = await this.caja.consumirAutorizacion(dto.autorizacionToken);
      autorizadoPor = auth?.usuarioId;
    }

    const { data, error } = await this.db.rpc('registrar_venta', {
      p_sucursal: sucursalId,
      p_items: items,
      p_pagos: dto.pagos,
      p_canal: dto.canal ?? 'mostrador',
      p_cliente_dni: dto.clienteDni ?? null,
      p_sesion_caja: dto.sesionCajaId ?? null,
      p_usuario: dto.usuarioId ?? null,
      p_venta_id: dto.ventaId ?? null,
      p_descuento_extra: dto.descuentoExtra ?? 0,
      p_autorizado_por: autorizadoPor ?? null,
      p_mayorista: dto.mayorista ?? false,
    });
    if (error) throw new BadRequestException(this.traducirError(error.message));

    const venta = data as any;
    // reintento offline de una venta ya registrada: no volver a emitir comprobante
    if (venta?.duplicada) return venta;

    // renglones con precio final (para el ticket impreso)
    venta.items = await this.itemsTicket(venta.venta_id);

    if (dto.comprobante) {
      try {
        venta.comprobante = await this.emitirComprobanteVenta({ ...dto, sucursalId }, venta.venta_id, montoCtaCte > 0);
      } catch (e) {
        // la venta ya está registrada y el stock movido: no se revierte por un
        // fallo de numeración. El comprobante puede emitirse desde Facturación.
        venta.comprobanteError = e instanceof Error ? e.message : 'No se pudo emitir el comprobante';
        this.log.error(`Venta ${venta.venta_id} sin comprobante: ${venta.comprobanteError}`);
      }
    }
    return venta;
  }

  // Emite el comprobante fiscal de la venta (FA/FB/REM) con numeración propia,
  // y corrige la cola ARCA que registrar_venta crea siempre como FB.
  private async emitirComprobanteVenta(dto: CrearVentaDto, ventaId: string, esCtaCte: boolean) {
    const tipo = dto.comprobante === 'A' ? 'FA' : dto.comprobante === 'R' ? 'REM' : 'FB';
    const { data: v } = await this.db.from('ventas').select('cliente_id').eq('id', ventaId).single();

    const receptor = dto.receptor
      ? {
          nombre: dto.receptor.nombre,
          docTipo: dto.comprobante === 'A' ? 'CUIT' : undefined,
          docNumero: dto.receptor.docNumero,
          condicionIva: dto.receptor.condicionIva ?? (dto.comprobante === 'A' ? 'responsable_inscripto' : undefined),
        }
      : undefined;

    const comprobante = await this.facturacion.emitir(
      {
        tipo,
        clienteId: v?.cliente_id ?? undefined,
        receptor,
        ventaId,
        condicionPago: esCtaCte ? 'cta_cte' : 'contado',
        sucursalId: dto.sucursalId,
        moverStock: false, // el stock ya lo movió registrar_venta
      },
      dto.usuarioId,
    );

    // cola ARCA: FA reemplaza al FB por defecto; el remito no es fiscal (sin CAE)
    if (tipo === 'FA') {
      await this.db.from('comprobantes_arca').update({ tipo: 'FA' }).eq('venta_id', ventaId);
    } else if (tipo === 'REM') {
      await this.db.from('comprobantes_arca').delete().eq('venta_id', ventaId);
    }
    return comprobante;
  }

  // Renglones de la venta con el precio final que cobró la base (no el del
  // display de la caja): es lo que se imprime en el ticket.
  private async itemsTicket(ventaId: string) {
    const { data } = await this.db
      .from('ventas_items')
      .select('cantidad, precio_unitario, producto:productos(sku, nombre)')
      .eq('venta_id', ventaId);
    return (data ?? []).map((r: any) => ({
      sku: r.producto?.sku,
      nombre: r.producto?.nombre,
      cantidad: Number(r.cantidad),
      precioUnitario: Number(r.precio_unitario),
      total: Math.round(Number(r.cantidad) * Number(r.precio_unitario) * 100) / 100,
    }));
  }

  // Devolución parcial desde caja: repone stock (RPC atómica con tope por lo ya
  // devuelto), emite la NC real si la venta tiene comprobante, y si el reintegro
  // es en efectivo registra el egreso en la sesión (para que cierre el arqueo).
  async devolver(ventaId: string, dto: DevolverDto) {
    const items = await Promise.all(
      (dto.items ?? []).map(async (i) => ({
        producto_id: await this.productoIdPorSku(i.sku),
        cantidad: Number(i.cantidad),
      })),
    );

    // Igual que en registrar(): sin autorizadoPor directo (gerente/dueño self),
    // se exige un token de PIN de un solo uso consumido acá mismo.
    let autorizadoPor = dto.autorizadoPor;
    if (!autorizadoPor && dto.autorizacionToken) {
      const auth = await this.caja.consumirAutorizacion(dto.autorizacionToken);
      autorizadoPor = auth?.usuarioId;
    }
    if (!autorizadoPor) throw new BadRequestException('La devolución requiere autorización de un supervisor (PIN)');

    const { data, error } = await this.db.rpc('devolver_venta_parcial', {
      p_venta: ventaId,
      p_items: items,
      p_usuario: dto.usuarioId ?? null,
      p_autorizado_por: autorizadoPor,
    });
    if (error) throw new BadRequestException(this.traducirError(error.message));
    const resultado = data as any;
    const monto = Number(resultado.monto);

    // NC fiscal real, referenciando la factura original de la venta (si existe)
    let nc: any = null;
    try {
      const { data: original } = await this.db
        .from('comprobantes')
        .select('id, tipo, cliente_id')
        .eq('venta_id', ventaId)
        .in('tipo', ['FA', 'FB', 'FC'])
        .maybeSingle();
      const letra = original ? original.tipo.slice(-1) : 'B';
      nc = await this.facturacion.emitir(
        {
          tipo: `NC${letra}` as any,
          clienteId: original?.cliente_id ?? undefined,
          referenciaId: original?.id ?? undefined,
          importe: monto,
          concepto: 'Devolución parcial de venta',
          observaciones: `Devolución parcial · venta ${ventaId}`,
        },
        dto.usuarioId,
      );
    } catch (e) {
      this.log.error(`Devolución ${ventaId} sin NC en comprobantes: ${e instanceof Error ? e.message : e}`);
    }

    // reintegro en efectivo: egreso de la sesión → el arqueo cierra
    if (dto.reintegro === 'efectivo' && dto.sesionCajaId) {
      await this.db.from('caja_movimientos').insert({
        sesion_id: dto.sesionCajaId,
        tipo: 'egreso',
        monto,
        motivo: `Reintegro devolución venta ${ventaId.slice(0, 8)}`,
        usuario_id: dto.usuarioId ?? null,
      });
    }

    return { ...resultado, nc };
  }

  // La cuenta corriente exige cliente con cuenta habilitada y crédito disponible.
  private async validarCtaCte(clienteDni: string | undefined, monto: number) {
    const dni = clienteDni?.trim();
    if (!dni) throw new BadRequestException('Cuenta corriente: identificá al cliente');
    const { data: cliente } = await this.db
      .from('clientes')
      .select('id, nombre, razon_social, cta_cte_habilitada, limite_credito')
      .eq('dni', dni)
      .maybeSingle();
    if (!cliente) throw new BadRequestException('Cuenta corriente: el cliente no está registrado');
    if (!cliente.cta_cte_habilitada) {
      throw new BadRequestException(`${cliente.razon_social ?? cliente.nombre ?? 'El cliente'} no tiene cuenta corriente habilitada`);
    }
    const limite = Number(cliente.limite_credito ?? 0);
    if (limite > 0) {
      const { data: saldo } = await this.db.rpc('saldo_cuenta', { p_cliente: cliente.id });
      if (Number(saldo ?? 0) + monto > limite + 0.01) {
        throw new BadRequestException(
          `Supera el límite de crédito: saldo $${Number(saldo ?? 0).toLocaleString('es-AR')} + $${monto.toLocaleString('es-AR')} > límite $${limite.toLocaleString('es-AR')}`,
        );
      }
    }
  }

  async listar(f: { limite?: number; estado?: string; sucursalId?: string; medioPago?: string; dias?: number; buscar?: string } = {}) {
    let query = this.db
      .from('ventas')
      .select(
        `id, canal, estado, subtotal, descuento, total, vendida_en,
         sucursal:sucursales(nombre),
         cliente:clientes(dni, nombre, tipo),
         items:ventas_items(cantidad, precio_unitario, producto:productos(sku, nombre)),
         pagos(medio, monto)`,
      )
      .order('vendida_en', { ascending: false })
      .limit(Math.min((f.medioPago || f.buscar) ? 300 : (f.limite ?? 30), 300));
    if (f.estado) query = query.eq('estado', f.estado);
    if (f.sucursalId) query = query.eq('sucursal_id', f.sucursalId);
    if (f.dias) query = query.gte('vendida_en', new Date(Date.now() - f.dias * 86400_000).toISOString());
    const { data, error } = await query;
    if (error) throw new BadRequestException(error.message);

    let filas = (data ?? []) as any[];
    // medio de pago y búsqueda libre se filtran sobre la página (display intacto)
    if (f.medioPago) filas = filas.filter((v) => (v.pagos ?? []).some((p: any) => p.medio === f.medioPago));
    if (f.buscar?.trim()) {
      const t = f.buscar.trim().toLowerCase();
      filas = filas.filter((v) =>
        v.id.toLowerCase().includes(t) ||
        (v.cliente?.dni ?? '').includes(t) ||
        (v.cliente?.nombre ?? '').toLowerCase().includes(t),
      );
    }
    return filas.slice(0, f.limite ?? 50);
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
    const porCanal: Record<string, number> = {};
    for (const v of ventas) {
      const suc = v.sucursal?.nombre ?? '—';
      porSucursal[suc] ??= { facturado: 0, tickets: 0 };
      porSucursal[suc].facturado += Number(v.total);
      porSucursal[suc].tickets += 1;
      porCanal[v.canal] = (porCanal[v.canal] ?? 0) + Number(v.total);
    }

    // medios de pago del día
    const { data: pagos } = await this.db
      .from('pagos')
      .select('medio, monto, venta:ventas!inner(vendida_en, estado)')
      .gte('venta.vendida_en', desde.toISOString())
      .eq('venta.estado', 'completada');
    const porMedio: Record<string, number> = {};
    for (const p of (pagos ?? []) as any[]) porMedio[p.medio] = (porMedio[p.medio] ?? 0) + Number(p.monto);

    return {
      tickets: ventas.length,
      facturado,
      descuentos,
      ticketPromedio: ventas.length ? facturado / ventas.length : 0,
      porSucursal,
      porMedio,
      porCanal,
    };
  }

  // Anulación con devolución de stock y nota de crédito en cola ARCA.
  // RPC atómica: devolución + estado + NC salen juntos o no sale nada.
  async anular(ventaId: string, usuarioId?: string) {
    const { data, error } = await this.db.rpc('anular_venta', {
      p_venta: ventaId,
      p_usuario: usuarioId ?? null,
    });
    if (error) throw new BadRequestException(error.message);
    return { anulada: true, total: Number((data as any).total) };
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
