import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase.provider';

// Tipos de comprobante estilo Tango. Las letras siguen la condición fiscal:
// A discrimina IVA (responsable inscripto), B consumidor final, C monotributo.
export const TIPOS = {
  FA: 'Factura A', FB: 'Factura B', FC: 'Factura C',
  NCA: 'Nota de crédito A', NCB: 'Nota de crédito B', NCC: 'Nota de crédito C',
  NDA: 'Nota de débito A', NDB: 'Nota de débito B', NDC: 'Nota de débito C',
  REM: 'Remito', REC: 'Recibo de cobranza', ANT: 'Anticipo', SIN: 'Comprobante interno',
} as const;

export type TipoComprobante = keyof typeof TIPOS;

const FISCALES: TipoComprobante[] = ['FA', 'FB', 'FC', 'NCA', 'NCB', 'NCC', 'NDA', 'NDB', 'NDC'];
const CREDITOS: TipoComprobante[] = ['NCA', 'NCB', 'NCC', 'REC', 'ANT']; // generan haber en cta cte
const DEBITOS: TipoComprobante[] = ['FA', 'FB', 'FC', 'NDA', 'NDB', 'NDC']; // generan debe (si es cta cte)

export type ItemComprobante = {
  sku?: string;
  descripcion: string;
  cantidad: number;
  precioUnitario: number; // SIEMPRE final con IVA incluido; el neto se calcula acá
  alicuota?: number; // 21 | 10.5 | 0
};

export type EmitirDto = {
  tipo: TipoComprobante;
  clienteId?: string;
  receptor?: { nombre?: string; docTipo?: string; docNumero?: string; condicionIva?: string; domicilio?: string };
  ventaId?: string;
  referenciaId?: string; // NC/ND → factura original
  items?: ItemComprobante[];
  importe?: number; // para REC/ANT o ND de concepto libre
  concepto?: string;
  condicionPago?: 'contado' | 'cta_cte';
  sucursalId?: string; // REM: de dónde sale la mercadería
  moverStock?: boolean; // REM manual: descontar stock
  observaciones?: string;
};

@Injectable()
export class FacturacionService {
  constructor(@Inject(SUPABASE) private readonly db: SupabaseClient) {}

  // ---------- listado y detalle ----------

  async listar(q: { tipo?: string; buscar?: string; desde?: string; hasta?: string; limite?: number; clienteId?: string }) {
    let query = this.db
      .from('comprobantes')
      .select('id, tipo, punto_venta, numero, emitido_en, total, estado, condicion_pago, cae, receptor, cliente:clientes(nombre, razon_social, dni), referencia_id')
      .order('emitido_en', { ascending: false })
      .limit(Math.min(q.limite ?? 80, 200));
    if (q.tipo) query = query.in('tipo', q.tipo.split(','));
    if (q.clienteId) query = query.eq('cliente_id', q.clienteId);
    if (q.desde) query = query.gte('emitido_en', q.desde);
    if (q.hasta) query = query.lte('emitido_en', q.hasta);
    const { data, error } = await query;
    if (error) throw new BadRequestException(error.message);
    let filas = data ?? [];
    if (q.buscar?.trim()) {
      const t = q.buscar.trim().toLowerCase();
      filas = filas.filter((c: any) =>
        String(c.numero).includes(t) ||
        (c.receptor?.nombre ?? '').toLowerCase().includes(t) ||
        (c.cliente?.nombre ?? '').toLowerCase().includes(t) ||
        (c.cliente?.razon_social ?? '').toLowerCase().includes(t) ||
        (c.cliente?.dni ?? '').includes(t),
      );
    }
    return filas;
  }

  async detalle(id: string) {
    const { data, error } = await this.db
      .from('comprobantes')
      .select('*, cliente:clientes(nombre, razon_social, dni, cuit, condicion_iva, domicilio)')
      .eq('id', id)
      .single();
    if (error) throw new BadRequestException('No existe el comprobante');
    if (data.referencia_id) {
      const { data: ref } = await this.db
        .from('comprobantes')
        .select('tipo, punto_venta, numero')
        .eq('id', data.referencia_id)
        .maybeSingle();
      (data as any).referencia = ref ?? null;
    }
    return data;
  }

  // ---------- emisión ----------

  async emitir(dto: EmitirDto, usuarioId?: string) {
    const tipo = dto.tipo;
    if (!TIPOS[tipo]) throw new BadRequestException(`Tipo de comprobante inválido: ${tipo}`);

    // receptor: del cliente, del body, o consumidor final
    let cliente: any = null;
    if (dto.clienteId) {
      const { data } = await this.db
        .from('clientes')
        .select('id, nombre, razon_social, dni, cuit, condicion_iva, domicilio, cta_cte_habilitada, limite_credito')
        .eq('id', dto.clienteId)
        .maybeSingle();
      if (!data) throw new BadRequestException('No existe el cliente');
      cliente = data;
    }
    const receptor = {
      nombre: dto.receptor?.nombre ?? cliente?.razon_social ?? cliente?.nombre ?? 'Consumidor final',
      doc_tipo: dto.receptor?.docTipo ?? (cliente?.cuit ? 'CUIT' : cliente?.dni ? 'DNI' : '—'),
      doc_numero: dto.receptor?.docNumero ?? cliente?.cuit ?? cliente?.dni ?? null,
      condicion_iva: dto.receptor?.condicionIva ?? cliente?.condicion_iva ?? 'consumidor_final',
      domicilio: dto.receptor?.domicilio ?? cliente?.domicilio ?? null,
    };

    // coherencia letra ↔ condición fiscal (regla de oro de cualquier Tango)
    if (tipo.endsWith('A') && FISCALES.includes(tipo) && receptor.condicion_iva !== 'responsable_inscripto') {
      throw new BadRequestException('Los comprobantes A son solo para responsables inscriptos (con CUIT)');
    }
    if (tipo.endsWith('A') && !receptor.doc_numero) {
      throw new BadRequestException('Los comprobantes A requieren CUIT del receptor');
    }
    if ((tipo === 'NCA' || tipo === 'NCB' || tipo === 'NCC' || tipo.startsWith('ND')) && !dto.referenciaId && !dto.ventaId && !dto.importe && !dto.items?.length) {
      throw new BadRequestException('Las notas necesitan comprobante de referencia, items o importe');
    }

    // items: desde la venta, del body, o concepto libre por importe
    let items: ItemComprobante[] = dto.items ?? [];
    let ventaId = dto.ventaId ?? null;
    if (ventaId && !items.length) {
      items = await this.itemsDesdeVenta(ventaId);
    }
    if (!items.length) {
      if (!dto.importe || dto.importe <= 0) {
        throw new BadRequestException('Indicá items o un importe mayor a cero');
      }
      items = [{ descripcion: dto.concepto ?? TIPOS[tipo], cantidad: 1, precioUnitario: dto.importe, alicuota: tipo === 'REC' || tipo === 'ANT' ? 0 : 21 }];
    }

    // NC: no puede superar lo facturado menos lo ya acreditado contra esa factura
    if (tipo.startsWith('NC') && dto.referenciaId) {
      await this.validarTopeNota(dto.referenciaId, items);
    }

    const { neto, iva, ivaDetalle, total } = this.calcularIva(items, tipo);

    // venta a cuenta corriente: el cliente tiene que tenerla habilitada y con crédito
    if ((dto.condicionPago ?? 'contado') === 'cta_cte' && DEBITOS.includes(tipo)) {
      if (!cliente) throw new BadRequestException('La cuenta corriente requiere un cliente identificado');
      if (!cliente.cta_cte_habilitada) {
        throw new BadRequestException(`${cliente.razon_social ?? cliente.nombre ?? 'El cliente'} no tiene cuenta corriente habilitada`);
      }
      const limite = Number(cliente.limite_credito ?? 0);
      if (limite > 0) {
        const { data: saldoActual } = await this.db.rpc('saldo_cuenta', { p_cliente: cliente.id });
        if (Number(saldoActual ?? 0) + total > limite + 0.01) {
          throw new BadRequestException(
            `Supera el límite de crédito: saldo $${Number(saldoActual ?? 0).toLocaleString('es-AR')} + $${total.toLocaleString('es-AR')} > límite $${limite.toLocaleString('es-AR')}`,
          );
        }
      }
    }

    // punto de venta: el de la sucursal si se indicó, sino 1
    let puntoVenta = 1;
    if (dto.sucursalId) {
      const { data: suc } = await this.db
        .from('sucursales')
        .select('punto_venta_arca')
        .eq('id', dto.sucursalId)
        .maybeSingle();
      puntoVenta = suc?.punto_venta_arca ?? 1;
    }

    const { data: numero, error: errNum } = await this.db.rpc('proximo_numero', {
      p_tipo: tipo,
      p_pv: puntoVenta,
    });
    if (errNum) throw new BadRequestException(errNum.message);

    const { data: comprobante, error } = await this.db
      .from('comprobantes')
      .insert({
        tipo,
        punto_venta: puntoVenta,
        numero,
        cliente_id: cliente?.id ?? null,
        receptor,
        venta_id: ventaId,
        referencia_id: dto.referenciaId ?? null,
        items,
        neto,
        iva,
        iva_detalle: ivaDetalle,
        total,
        observaciones: dto.observaciones ?? null,
        condicion_pago: dto.condicionPago ?? 'contado',
        usuario_id: usuarioId ?? null,
      })
      .select('id, tipo, punto_venta, numero, total')
      .single();
    if (error) throw new BadRequestException(error.message);

    // cuenta corriente
    await this.asentarCtaCte(comprobante, cliente?.id ?? null, dto.condicionPago ?? 'contado', dto.concepto);

    // remito manual: mueve stock de la sucursal de origen
    if (tipo === 'REM' && dto.moverStock && dto.sucursalId) {
      await this.descontarStockRemito(items, dto.sucursalId, comprobante, usuarioId);
    }

    return comprobante;
  }

  // anulación con criterio fiscal: las facturas/ND se revierten con su NC
  // automática; el resto se marca anulado y se revierte la cta cte
  async anular(id: string, usuarioId?: string) {
    const c = await this.detalle(id);
    if (c.estado === 'anulado') throw new BadRequestException('Ya está anulado');

    if (DEBITOS.includes(c.tipo as TipoComprobante)) {
      const letra = c.tipo.slice(-1) as 'A' | 'B' | 'C';
      const nc = await this.emitir(
        {
          tipo: `NC${letra}` as TipoComprobante,
          clienteId: c.cliente_id ?? undefined,
          receptor: c.cliente_id ? undefined : {
            nombre: c.receptor?.nombre,
            docTipo: c.receptor?.doc_tipo,
            docNumero: c.receptor?.doc_numero,
            condicionIva: c.receptor?.condicion_iva,
            domicilio: c.receptor?.domicilio,
          },
          referenciaId: c.id,
          items: c.items,
          condicionPago: c.condicion_pago,
          observaciones: `Anulación de ${TIPOS[c.tipo as TipoComprobante]} ${this.numeroLindo(c)}`,
        },
        usuarioId,
      );
      return { anuladoCon: nc };
    }

    await this.db.from('comprobantes').update({ estado: 'anulado' }).eq('id', id);
    // revertir el efecto en cuenta corriente, si lo tuvo
    const { data: asientos } = await this.db
      .from('cuenta_corriente')
      .select('cliente_id, concepto, debe, haber')
      .eq('comprobante_id', id);
    for (const a of asientos ?? []) {
      await this.db.from('cuenta_corriente').insert({
        cliente_id: a.cliente_id,
        comprobante_id: id,
        concepto: `Anulación · ${a.concepto}`,
        debe: a.haber,
        haber: a.debe,
      });
    }
    return { anulado: true };
  }

  // ---------- cuenta corriente ----------

  async cuenta(clienteId: string) {
    const [{ data: cliente }, { data: movimientos }, { data: saldo }] = await Promise.all([
      this.db
        .from('clientes')
        .select('id, nombre, razon_social, dni, cuit, condicion_iva, telefono')
        .eq('id', clienteId)
        .single(),
      this.db
        .from('cuenta_corriente')
        .select('concepto, debe, haber, creado_en, comprobante:comprobantes(tipo, punto_venta, numero)')
        .eq('cliente_id', clienteId)
        .order('id', { ascending: false })
        .limit(100),
      this.db.rpc('saldo_cuenta', { p_cliente: clienteId }),
    ]);
    if (!cliente) throw new BadRequestException('No existe el cliente');
    return { cliente, saldo: Number(saldo ?? 0), movimientos: movimientos ?? [] };
  }

  async cuentas() {
    // clientes con movimientos: saldo de cada uno (para el tablero de cobranzas)
    const { data, error } = await this.db
      .from('cuenta_corriente')
      .select('cliente_id, debe, haber, cliente:clientes(id, nombre, razon_social, dni, telefono)');
    if (error) throw new BadRequestException(error.message);
    const porCliente = new Map<string, any>();
    for (const m of (data ?? []) as any[]) {
      const acc = porCliente.get(m.cliente_id) ?? { cliente: m.cliente, saldo: 0 };
      acc.saldo += Number(m.debe) - Number(m.haber);
      porCliente.set(m.cliente_id, acc);
    }
    return [...porCliente.values()]
      .map((c) => ({ ...c, saldo: Math.round(c.saldo * 100) / 100 }))
      .sort((a, b) => b.saldo - a.saldo);
  }

  // ---------- internos ----------

  private async itemsDesdeVenta(ventaId: string): Promise<ItemComprobante[]> {
    const { data: venta, error } = await this.db
      .from('ventas')
      .select('id, estado, items:ventas_items(cantidad, precio_unitario, producto:productos(sku, nombre, alicuota_iva))')
      .eq('id', ventaId)
      .single();
    if (error || !venta) throw new BadRequestException('No existe la venta');
    return ((venta.items ?? []) as any[]).map((i) => ({
      sku: i.producto?.sku,
      descripcion: i.producto?.nombre ?? 'Artículo',
      cantidad: Number(i.cantidad),
      precioUnitario: Number(i.precio_unitario),
      alicuota: Number(i.producto?.alicuota_iva ?? 21),
    }));
  }

  // los precios entran SIEMPRE con IVA incluido; acá se abre neto + IVA por alícuota
  private calcularIva(items: ItemComprobante[], tipo: TipoComprobante) {
    const porAlicuota = new Map<number, { base: number; monto: number }>();
    let neto = 0, iva = 0, total = 0;
    for (const i of items) {
      const cantidad = Number(i.cantidad);
      const precio = Number(i.precioUnitario);
      if (!(cantidad > 0) || !(precio >= 0)) {
        throw new BadRequestException(`Renglón inválido: ${i.descripcion}`);
      }
      const alicuota = tipo === 'REM' ? 0 : Number(i.alicuota ?? 21);
      const renglon = precio * cantidad;
      const base = alicuota > 0 ? renglon / (1 + alicuota / 100) : renglon;
      const montoIva = renglon - base;
      total += renglon;
      neto += base;
      iva += montoIva;
      if (alicuota > 0) {
        const acc = porAlicuota.get(alicuota) ?? { base: 0, monto: 0 };
        acc.base += base;
        acc.monto += montoIva;
        porAlicuota.set(alicuota, acc);
      }
    }
    const r = (n: number) => Math.round(n * 100) / 100;
    return {
      neto: r(neto),
      iva: r(iva),
      total: r(total),
      ivaDetalle: [...porAlicuota.entries()].map(([alicuota, v]) => ({
        alicuota,
        base: r(v.base),
        monto: r(v.monto),
      })),
    };
  }

  private async validarTopeNota(referenciaId: string, items: ItemComprobante[]) {
    const { data: factura } = await this.db
      .from('comprobantes')
      .select('total, tipo')
      .eq('id', referenciaId)
      .maybeSingle();
    if (!factura) throw new BadRequestException('No existe el comprobante de referencia');
    const { data: previas } = await this.db
      .from('comprobantes')
      .select('total')
      .eq('referencia_id', referenciaId)
      .eq('estado', 'emitido')
      .in('tipo', ['NCA', 'NCB', 'NCC']);
    const acreditado = (previas ?? []).reduce((s, n) => s + Number(n.total), 0);
    const nota = items.reduce((s, i) => s + Number(i.precioUnitario) * Number(i.cantidad), 0);
    if (nota > Number(factura.total) - acreditado + 0.01) {
      throw new BadRequestException(
        `La nota ($${nota.toFixed(2)}) supera el saldo de la factura ($${(Number(factura.total) - acreditado).toFixed(2)})`,
      );
    }
  }

  private async asentarCtaCte(comprobante: any, clienteId: string | null, condicionPago: string, concepto?: string) {
    if (!clienteId) return;
    const tipo = comprobante.tipo as TipoComprobante;
    const etiqueta = `${TIPOS[tipo]} ${this.numeroLindo(comprobante)}${concepto ? ` · ${concepto}` : ''}`;
    if (DEBITOS.includes(tipo) && condicionPago === 'cta_cte') {
      await this.db.from('cuenta_corriente').insert({
        cliente_id: clienteId,
        comprobante_id: comprobante.id,
        concepto: etiqueta,
        debe: comprobante.total,
      });
    } else if (CREDITOS.includes(tipo)) {
      await this.db.from('cuenta_corriente').insert({
        cliente_id: clienteId,
        comprobante_id: comprobante.id,
        concepto: etiqueta,
        haber: comprobante.total,
      });
    } else {
      return; // sin efecto en cta cte: sin notificación
    }
    const { data: saldo } = await this.db.rpc('saldo_cuenta', { p_cliente: clienteId });
    const monto = '$' + Math.round(comprobante.total).toLocaleString('es-AR');
    const esCargo = DEBITOS.includes(tipo);
    await this.notificar(
      clienteId,
      esCargo ? `Nuevo cargo en tu cuenta: ${monto}` : `Pago registrado: ${monto}`,
      `${etiqueta}. Tu saldo es $${Math.round(Number(saldo ?? 0)).toLocaleString('es-AR')}.`,
    );
  }

  async notificar(clienteId: string, titulo: string, cuerpo: string) {
    await this.db.from('notificaciones').insert({ cliente_id: clienteId, titulo, cuerpo });
  }

  private async descontarStockRemito(items: ItemComprobante[], sucursalId: string, comprobante: any, usuarioId?: string) {
    for (const i of items) {
      if (!i.sku) continue;
      const { data: prod } = await this.db.from('productos').select('id').eq('sku', i.sku).maybeSingle();
      if (!prod) continue;
      const { error } = await this.db.rpc('registrar_movimiento', {
        p_producto_id: prod.id,
        p_sucursal_id: sucursalId,
        p_tipo: 'ajuste',
        p_cantidad: -Math.abs(Number(i.cantidad)),
        p_motivo: `Remito ${this.numeroLindo(comprobante)}`,
        p_usuario_id: usuarioId ?? null,
      });
      if (error) throw new BadRequestException(error.message);
    }
  }

  private numeroLindo(c: { punto_venta: number; numero: number | bigint }) {
    return `${String(c.punto_venta).padStart(4, '0')}-${String(c.numero).padStart(8, '0')}`;
  }
}
