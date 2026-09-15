import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase.provider';
import { FacturacionService } from '../facturacion/facturacion.service';
import { CajaService } from '../caja/caja.service';
import { etiquetaMedio } from '../caja/cierre';
import { MercadoPagoService } from '../mercadopago/mercadopago.service';
import { enviarTextoWhatsapp } from '../comun/whatsapp';

export type CrearVentaDto = {
  sucursalId: string;
  canal?: 'mostrador' | 'self_checkout' | 'web' | 'whatsapp' | 'pickup';
  items: { sku: string; cantidad: number }[];
  // terminal: con cuál posnet se cobró la tarjeta (getnet/clover) — Sant Thomas tiene los dos
  pagos: { medio: string; monto: number; terminal?: string }[];
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
    private readonly mp: MercadoPagoService,
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

  // ============================================================
  // DEVOLUCIÓN CON AUTORIZACIÓN A DISTANCIA (2026-09-09)
  // ANTES: la devolución solo salía con el PIN del supervisor tecleado en el
  // mostrador. Si no estaba, no había forma de avisarle y la nota de crédito no
  // se hacía. AHORA: la cajera pide, a los supervisores les llega WhatsApp +
  // campanita, aprueban desde /aprobaciones y acá se ejecuta la devolución con
  // el mismo circuito de siempre (stock + NC + egreso), autorizada por quien firmó.
  // ============================================================
  async pedirDevolucion(
    ventaId: string,
    dto: { items: { sku: string; cantidad: number }[]; reintegro?: 'efectivo' | 'otro'; sesionCajaId?: string; motivo?: string; usuarioId?: string },
  ) {
    const items = (dto.items ?? [])
      .map((i) => ({ sku: String(i.sku ?? '').trim(), cantidad: Number(i.cantidad) }))
      .filter((i) => i.sku && Number.isFinite(i.cantidad) && i.cantidad > 0);
    if (!items.length) throw new BadRequestException('Elegí qué renglones se devuelven');
    const { data: venta, error } = await this.db
      .from('ventas')
      .select('id, sucursal_id, estado, items:ventas_items(cantidad, precio_unitario, producto:productos(sku, nombre))')
      .eq('id', ventaId)
      .maybeSingle();
    if (error || !venta) throw new BadRequestException('Venta inexistente');
    const porSku = new Map<string, any>(((venta as any).items ?? []).map((i: any) => [i.producto?.sku, i]));
    const detalle: { nombre: string; cantidad: number; precio: number }[] = [];
    let monto = 0;
    for (const it of items) {
      const v = porSku.get(it.sku);
      if (!v) throw new BadRequestException(`El producto ${it.sku} no está en esa venta`);
      if (it.cantidad > Number(v.cantidad)) throw new BadRequestException(`No se pueden devolver ${it.cantidad} de ${v.producto?.nombre}: la venta tiene ${v.cantidad}`);
      const precio = Number(v.precio_unitario);
      monto += precio * it.cantidad;
      detalle.push({ nombre: v.producto?.nombre ?? it.sku, cantidad: it.cantidad, precio });
    }
    monto = Math.round(monto * 100) / 100;
    const { data: previo } = await this.db
      .from('devoluciones_pendientes').select('id').eq('venta_id', ventaId).eq('estado', 'pendiente').maybeSingle();
    if (previo) throw new BadRequestException('Esa venta ya tiene una devolución esperando autorización');

    let cajaNombre: string | null = null;
    if (dto.sesionCajaId) {
      const { data: ses } = await this.db.from('sesiones_caja').select('caja:cajas(nombre)').eq('id', dto.sesionCajaId).maybeSingle();
      cajaNombre = (ses as any)?.caja?.nombre ?? null;
    }
    const { data: cajero } = dto.usuarioId
      ? await this.db.from('usuarios').select('nombre').eq('id', dto.usuarioId).maybeSingle()
      : { data: null as any };
    const reintegro = dto.reintegro === 'efectivo' ? 'efectivo' : 'otro';
    const { data: pedido, error: e2 } = await this.db
      .from('devoluciones_pendientes')
      .insert({
        venta_id: ventaId, items, detalle, monto, reintegro,
        sesion_caja_id: dto.sesionCajaId ?? null, cajero_id: dto.usuarioId ?? null,
        sucursal_id: (venta as any).sucursal_id ?? null, caja_nombre: cajaNombre,
        motivo: (dto.motivo ?? '').trim() || null,
      })
      .select('id')
      .single();
    if (e2 || !pedido) throw new BadRequestException(`No se pudo registrar el pedido: ${e2?.message ?? 'sin datos'}`);

    // El aviso sale YA, a todos los supervisores, por los dos canales.
    const { data: sup } = await this.db
      .from('usuarios').select('id, nombre, telefono').in('rol', ['dueno', 'gerente']).eq('activo', true);
    const { data: suc } = await this.db.from('sucursales').select('nombre').eq('id', (venta as any).sucursal_id).maybeSingle();
    const pesos = '$' + Math.round(monto).toLocaleString('es-AR');
    const renglones = detalle.map((d) => `${d.cantidad}× ${d.nombre}`).join(', ');
    const titulo = `Devolución en caja: ${pesos} esperando tu autorización`;
    const texto = `${cajero?.nombre ?? 'La caja'} (${cajaNombre ?? 'caja'}${suc?.nombre ? ' · ' + suc.nombre : ''}) pide devolver ${renglones}${reintegro === 'efectivo' ? ', con reintegro en efectivo' : ''}.`;
    const link = `${(process.env.ADMIN_URL ?? 'https://odb-admin-production.up.railway.app').replace(/\/$/, '')}/aprobaciones`;
    const avisos: any[] = [];
    for (const u of (sup ?? []) as any[]) {
      await this.db.from('alertas_internas').insert({
        para_usuario: u.id, tipo: 'devolucion', titulo,
        detalle: `${texto} Aprobala o rechazala en Aprobaciones.`,
        referencia: { devolucion_id: pedido.id, venta_id: ventaId, link: '/aprobaciones' },
      });
      let whatsapp = false;
      if (u.telefono) {
        try {
          const r = await enviarTextoWhatsapp(this.db, u.telefono, `ODB · ${titulo}\n${texto}\nAprobala o rechazala acá: ${link}`, 'devolucion');
          whatsapp = !!r.enviado;
          if (!r.enviado) this.log.warn(`aviso de devolución a ${u.nombre} sin WhatsApp: ${r.motivo}`);
        } catch (e) { this.log.warn(`aviso de devolución a ${u.nombre} falló: ${e instanceof Error ? e.message : e}`); }
      }
      avisos.push({ usuario: u.nombre, campanita: true, whatsapp });
    }
    await this.db.from('devoluciones_pendientes').update({ avisos }).eq('id', pedido.id);
    this.log.log(`devolución pedida a distancia: venta ${ventaId.slice(0, 8)} ${pesos} · avisados ${avisos.length}`);
    return { id: pedido.id, monto, avisados: ((sup ?? []) as any[]).map((u) => String(u.nombre).split(' ')[0]) };
  }

  async estadoDevolucion(id: string) {
    const { data } = await this.db
      .from('devoluciones_pendientes')
      .select('id, estado, monto, respuesta, resultado, error, resuelto:usuarios!devoluciones_pendientes_resuelta_por_fkey(nombre)')
      .eq('id', id)
      .maybeSingle();
    if (!data) throw new BadRequestException('Pedido inexistente');
    const d = data as any;
    return { id, estado: d.estado, monto: Number(d.monto), respuesta: d.respuesta, resultado: d.resultado, error: d.error, resueltaPor: d.resuelto?.nombre ?? null };
  }

  // Lo que ve la bandeja de aprobaciones.
  async devolucionesPendientes() {
    const { data, error } = await this.db
      .from('devoluciones_pendientes')
      .select('id, monto, detalle, reintegro, caja_nombre, motivo, creada_en, cajero:usuarios!devoluciones_pendientes_cajero_id_fkey(nombre), sucursal:sucursales(nombre)')
      .eq('estado', 'pendiente')
      .order('creada_en');
    if (error) throw new BadRequestException(error.message);
    return (data ?? []) as any[];
  }

  // Firma del supervisor desde la bandeja: acá se ejecuta la devolución real.
  async resolverDevolucion(id: string, decision: 'aprobar' | 'rechazar', usuarioId: string, motivo?: string) {
    const { data: p } = await this.db.from('devoluciones_pendientes').select('*').eq('id', id).maybeSingle();
    if (!p) throw new BadRequestException('Pedido inexistente');
    if (p.estado !== 'pendiente') throw new BadRequestException('Ese pedido ya fue resuelto');
    const ahora = new Date().toISOString();
    const { data: quien } = await this.db.from('usuarios').select('nombre').eq('id', usuarioId).maybeSingle();
    const pesos = '$' + Math.round(Number(p.monto)).toLocaleString('es-AR');
    const avisarCajero = async (titulo: string, detalle: string) => {
      if (!p.cajero_id) return;
      await this.db.from('alertas_internas').insert({
        para_usuario: p.cajero_id, tipo: 'devolucion', titulo, detalle, referencia: { devolucion_id: id, venta_id: p.venta_id },
      });
    };
    if (decision === 'rechazar') {
      await this.db.from('devoluciones_pendientes')
        .update({ estado: 'rechazada', resuelta_por: usuarioId, resuelta_en: ahora, respuesta: motivo ?? null })
        .eq('id', id).eq('estado', 'pendiente');
      await avisarCajero(`Devolución de ${pesos} rechazada por ${quien?.nombre ?? 'un supervisor'}`, motivo ? `Motivo: ${motivo}` : 'Sin motivo indicado.');
      return { rechazada: true };
    }
    try {
      const res: any = await this.devolver(p.venta_id, {
        items: p.items, reintegro: p.reintegro, sesionCajaId: p.sesion_caja_id ?? undefined,
        autorizadoPor: usuarioId, usuarioId: p.cajero_id ?? usuarioId,
      });
      const resultado = { monto: res?.monto ?? p.monto, nc: res?.nc ?? null, egreso: p.reintegro === 'efectivo' && !!p.sesion_caja_id };
      await this.db.from('devoluciones_pendientes')
        .update({ estado: 'aprobada', resuelta_por: usuarioId, resuelta_en: ahora, respuesta: motivo ?? null, resultado })
        .eq('id', id);
      await avisarCajero(`Devolución de ${pesos} autorizada por ${quien?.nombre ?? 'un supervisor'}`, `Stock repuesto${resultado.egreso ? ' · egreso de caja registrado: entregá el efectivo' : ''}.`);
      this.log.log(`devolución ${id.slice(0, 8)} autorizada por ${quien?.nombre ?? usuarioId} y ejecutada`);
      return { aprobada: true, ...resultado };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await this.db.from('devoluciones_pendientes')
        .update({ estado: 'error', resuelta_por: usuarioId, resuelta_en: ahora, error: msg })
        .eq('id', id);
      await avisarCajero(`La devolución de ${pesos} fue autorizada pero no se pudo ejecutar`, msg);
      throw new BadRequestException(`Se autorizó pero la devolución falló: ${msg}`);
    }
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

  // ============================================================
  // DETALLE Y CAMBIO DE MEDIO DE PAGO (2026-09-12)
  // El cliente ya pagó y se arrepiente ("¿me lo podés pasar a efectivo?").
  // Antes la única salida era anular la venta y rehacerla: se perdía el
  // comprobante y se ensuciaba el arqueo. Ahora se cambian los pagos dejando
  // la venta y la factura como están (la factura no depende del medio), con
  // PIN de supervisor y auditoría de qué había antes.
  // ============================================================

  // Todo lo de una venta para el panel de la caja: renglones, pagos,
  // comprobante y los cambios de medio de pago que ya tuvo.
  async detalle(ventaId: string) {
    const { data, error } = await this.db
      .from('ventas')
      .select(
        `id, canal, estado, subtotal, descuento, total, vendida_en, sesion_caja_id,
         sucursal:sucursales(nombre),
         cliente:clientes(id, dni, nombre, tipo),
         items:ventas_items(cantidad, precio_unitario, producto:productos(sku, nombre)),
         pagos(id, medio, monto, terminal, mp_payment_id)`,
      )
      .eq('id', ventaId)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new BadRequestException('Esa venta no existe');
    const v = data as any;

    const { data: comprobantes } = await this.db
      .from('comprobantes')
      .select('id, tipo, punto_venta, numero, cae, cae_vencimiento, estado, emitido_en, total')
      .eq('venta_id', ventaId)
      .order('emitido_en', { ascending: false });

    const { data: cambios } = await this.db
      .from('ventas_cambios_pago')
      .select('pagos_antes, pagos_despues, motivo, mp_refund_id, mp_estado, creado_en, usuario:usuarios!ventas_cambios_pago_usuario_id_fkey(nombre), autorizante:usuarios!ventas_cambios_pago_autorizado_por_fkey(nombre)')
      .eq('venta_id', ventaId)
      .order('creado_en', { ascending: false });

    return {
      id: v.id,
      ticket: v.id.slice(-8).toUpperCase(),
      estado: v.estado,
      canal: v.canal,
      vendidaEn: v.vendida_en,
      sesionCajaId: v.sesion_caja_id,
      sucursal: v.sucursal?.nombre ?? null,
      cliente: v.cliente ?? null,
      subtotal: Number(v.subtotal),
      descuento: Number(v.descuento),
      total: Number(v.total),
      items: (v.items ?? []).map((i: any) => ({
        sku: i.producto?.sku ?? null,
        nombre: i.producto?.nombre ?? '—',
        cantidad: Number(i.cantidad),
        precioUnitario: Number(i.precio_unitario),
        total: Math.round(Number(i.cantidad) * Number(i.precio_unitario) * 100) / 100,
      })),
      pagos: (v.pagos ?? []).map((p: any) => ({
        id: p.id,
        medio: p.medio,
        terminal: p.terminal ?? null,
        monto: Number(p.monto),
        mpPaymentId: p.mp_payment_id ?? null,
        etiqueta: etiquetaMedio(p.medio, p.terminal),
      })),
      comprobantes: (comprobantes ?? []).map((c: any) => ({
        id: c.id,
        tipo: c.tipo,
        numero: `${String(c.punto_venta).padStart(5, '0')}-${String(c.numero).padStart(8, '0')}`,
        cae: c.cae,
        caeVencimiento: c.cae_vencimiento,
        estado: c.estado,
        emitidoEn: c.emitido_en,
        total: Number(c.total),
      })),
      cambiosPago: (cambios ?? []).map((c: any) => ({
        antes: c.pagos_antes,
        despues: c.pagos_despues,
        motivo: c.motivo,
        mpRefundId: c.mp_refund_id,
        mpEstado: c.mp_estado,
        creadoEn: c.creado_en,
        usuario: c.usuario?.nombre ?? null,
        autorizante: c.autorizante?.nombre ?? null,
      })),
    };
  }

  // Reemplaza los pagos de una venta ya cobrada. Si lo que se saca es un pago
  // de Mercado Pago, PRIMERO se le devuelve la plata al cliente por MP: si el
  // reembolso falla, no se toca nada (si no, el arqueo diría efectivo y la
  // plata seguiría en la cuenta de MP).
  async cambiarMedioPago(
    ventaId: string,
    dto: {
      pagos: { medio: string; monto: number; terminal?: string }[];
      motivo?: string;
      autorizadoPor?: string;
      autorizacionToken?: string;
      usuarioId?: string;
    },
  ) {
    const pagos = (dto.pagos ?? [])
      .map((p) => ({
        medio: String(p.medio ?? '').trim(),
        monto: Math.round(Number(p.monto) * 100) / 100,
        terminal: p.terminal?.trim() || undefined,
      }))
      .filter((p) => p.medio && Number.isFinite(p.monto) && p.monto > 0);
    if (!pagos.length) throw new BadRequestException('Indicá con qué queda pagada la venta');

    let autorizadoPor = dto.autorizadoPor;
    if (!autorizadoPor && dto.autorizacionToken) {
      const auth = await this.caja.consumirAutorizacion(dto.autorizacionToken);
      autorizadoPor = auth?.usuarioId;
    }
    if (!autorizadoPor) throw new BadRequestException('Cambiar el medio de pago requiere autorización de un supervisor (PIN)');

    const { data: venta } = await this.db.from('ventas').select('id, total, estado').eq('id', ventaId).maybeSingle();
    if (!venta) throw new BadRequestException('Esa venta no existe');
    if ((venta as any).estado !== 'completada') throw new BadRequestException('La venta no está completada');
    const suma = pagos.reduce((a, p) => a + p.monto, 0);
    if (Math.abs(suma - Number((venta as any).total)) > 0.01) {
      throw new BadRequestException(
        `Los pagos suman $${suma.toLocaleString('es-AR')} y la venta es de $${Number((venta as any).total).toLocaleString('es-AR')}`,
      );
    }

    // ¿había Mercado Pago y deja de haberlo (o baja el importe)? → devolver la diferencia
    const { data: pagosActuales } = await this.db
      .from('pagos').select('medio, monto').eq('venta_id', ventaId);
    const mpAntes = ((pagosActuales ?? []) as any[])
      .filter((p) => p.medio === 'mercadopago')
      .reduce((a, p) => a + Number(p.monto), 0);
    const mpDespues = pagos.filter((p) => p.medio === 'mercadopago').reduce((a, p) => a + p.monto, 0);
    const aDevolver = Math.round((mpAntes - mpDespues) * 100) / 100;

    let mp: { paymentId: string; refundId: string | null; estado: string } | null = null;
    if (aDevolver > 0) {
      const pagoMP = await this.mp.pagoMPDeVenta(ventaId);
      if (!pagoMP) {
        throw new BadRequestException(
          'Esa venta no tiene identificada la operación de Mercado Pago, así que no se puede devolver automáticamente. Devolvela desde la app de Mercado Pago y avisá a gerencia.',
        );
      }
      const total = Math.abs(aDevolver - pagoMP.monto) < 0.01;
      const r = await this.mp.reembolsar(pagoMP.paymentId, total ? undefined : aDevolver, pagoMP.cuenta);
      mp = { paymentId: pagoMP.paymentId, refundId: r.refundId, estado: r.estado };
    }

    const { data, error } = await this.db.rpc('cambiar_medio_pago_venta', {
      p_venta: ventaId,
      p_pagos: pagos,
      p_usuario: dto.usuarioId ?? null,
      p_autorizado_por: autorizadoPor,
      p_motivo: dto.motivo ?? null,
      p_mp: mp,
    });
    if (error) {
      // el reembolso ya salió: que quede el rastro aunque el cambio no entre
      if (mp) this.log.error(`Venta ${ventaId}: se reembolsó MP ${mp.paymentId} pero falló el cambio de pagos: ${error.message}`);
      throw new BadRequestException(this.traducirError(error.message));
    }
    this.log.log(`Venta ${ventaId}: medio de pago cambiado por ${dto.usuarioId ?? '—'} (autorizó ${autorizadoPor})${mp ? ` · devuelto por MP ${mp.refundId ?? mp.paymentId}` : ''}`);
    return { ...(data as any), mp };
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
  // Busca por DNI o por CUIT: en el mostrador tanto da lo que tenga a mano el
  // cliente, y los de cuenta corriente casi siempre dan el CUIT.
  async clientePorDni(dni: string) {
    const doc = String(dni ?? '').trim();
    const soloDigitos = doc.replace(/\D/g, '');
    const COLUMNAS = 'id, dni, cuit, nombre, razon_social, tipo, puntos, verificado, telefono, acepta_marketing, cta_cte_habilitada, saldo_cta_cte, limite_credito';

    let { data: cliente, error } = await this.db
      .from('clientes')
      .select(COLUMNAS)
      .eq('dni', doc)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);

    // por CUIT, con y sin guiones (se guarda de las dos formas según de dónde vino)
    if (!cliente && soloDigitos.length === 11) {
      const conGuiones = `${soloDigitos.slice(0, 2)}-${soloDigitos.slice(2, 10)}-${soloDigitos.slice(10)}`;
      const { data } = await this.db
        .from('clientes')
        .select(COLUMNAS)
        .or(`cuit.eq.${soloDigitos},cuit.eq.${conGuiones}`)
        .limit(1)
        .maybeSingle();
      cliente = data ?? null;
    }
    if (!cliente) return { existe: false, dni: doc };

    const { data: ventas } = await this.db
      .from('ventas')
      .select('total')
      .eq('cliente_id', cliente.id)
      .eq('estado', 'completada');
    const compras = ventas?.length ?? 0;
    const gastado = (ventas ?? []).reduce((s, v) => s + Number(v.total), 0);
    // Perfil de compra: con 3 compras o más, el cajero ve qué suele llevar y
    // cada cuánto viene. Sirve para atender ("¿le pongo el Speed de siempre?")
    // y para que el sistema catalogue solo al cliente por lo que consume.
    const { data: perfilRaw } = await this.db.rpc('perfil_compra', { p_cliente: cliente.id });
    const perfil: any = perfilRaw ?? {};

    // Cuenta corriente: el cajero tiene que poder decirle al cliente cuánto
    // debía ANTES de esta venta. Saldo positivo = debe.
    const saldo = Number((cliente as any).saldo_cta_cte ?? 0);
    const limite = Number((cliente as any).limite_credito ?? 0);
    return {
      existe: true,
      ...cliente,
      razonSocial: (cliente as any).razon_social ?? null,
      aceptaMarketing: cliente.acepta_marketing === true,
      ctaCte: {
        habilitada: (cliente as any).cta_cte_habilitada === true,
        saldo, // > 0 = el cliente debe
        limite,
        disponible: limite > 0 ? Math.max(limite - saldo, 0) : null,
      },
      compras,
      ticketPromedio: compras ? Math.round(gastado / compras) : 0,
      perfil: perfil?.listo === true
        ? {
            compras: perfil.compras,
            gastado: perfil.gastado,
            ticketPromedio: perfil.ticketPromedio,
            cadaCuantosDias: perfil.cadaCuantosDias,
            diasDesdeUltima: perfil.diasDesdeUltima,
            rubros: perfil.rubros ?? [],
            habituales: perfil.habituales ?? [],
          }
        : null,
      // cuántas compras faltan para que el perfil aparezca
      faltanParaPerfil: perfil?.listo === true ? 0 : Math.max(0, 3 - Number(perfil?.compras ?? 0)),
    };
  }

  // Alta del contacto de WhatsApp desde la caja. Es lo único que el cajero puede
  // tocar del cliente: teléfono y consentimiento, nada fiscal ni de crédito.
  // Sin este dato no hay a quién difundir: la lista se construye acá, cliente
  // por cliente, en el momento en que la persona está enfrente.
  async sumarContactoWhatsapp(dni: string, dto: { telefono?: string; acepta: boolean }, usuarioId?: string) {
    const doc = String(dni ?? '').trim();
    if (!doc) throw new BadRequestException('Falta el DNI del cliente');

    const telefono = String(dto.telefono ?? '').replace(/\D/g, '');
    if (telefono && telefono.length < 10) {
      throw new BadRequestException('El teléfono tiene que tener al menos 10 dígitos (con característica, sin 0 ni 15)');
    }

    const { data: cliente } = await this.db.from('clientes').select('id').eq('dni', doc).maybeSingle();
    if (!cliente) throw new BadRequestException('Primero registrá al cliente en la venta');

    const cambios: Record<string, any> = { acepta_marketing: dto.acepta };
    if (telefono) cambios.telefono = telefono;
    // el opt-out queda fechado: es la prueba de que se respetó la baja
    cambios.marketing_optout_en = dto.acepta ? null : new Date().toISOString();
    if (dto.acepta) cambios.consentimiento_datos = new Date().toISOString();

    const { error } = await this.db.from('clientes').update(cambios).eq('id', cliente.id);
    if (error) throw new BadRequestException(error.message);

    await this.db.from('auditoria').insert({
      usuario_id: usuarioId ?? null,
      accion: dto.acepta ? 'alta_contacto_whatsapp' : 'baja_contacto_whatsapp',
      entidad: 'clientes',
      entidad_id: cliente.id,
      datos_despues: { telefono: telefono || undefined, acepta: dto.acepta },
    });

    return { ok: true, telefono: telefono || undefined, aceptaMarketing: dto.acepta };
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
