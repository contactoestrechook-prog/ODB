import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase.provider';
import { enviarPush } from './push';
import { calcularIva, RenglonInvalidoError, type ItemComprobante } from './iva';
import { saldosPorCliente, agruparResumen, numeroLindo } from './cuentas';
import { libroIvaVentas, libroIvaCompras, resumenIva } from './libro-iva';

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

export type { ItemComprobante }; // re-export: el tipo vive en el motor puro ./iva

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

// Recibo de cobranza PRO: imputa el cobro a facturas concretas y desglosa
// los medios de pago (efectivo, transferencia, cheque de terceros, etc.).
export type ReciboMedioDto = {
  medio: 'efectivo' | 'transferencia' | 'cheque' | 'tarjeta' | 'deposito' | 'retencion' | 'nota_credito';
  importe: number;
  referencia?: string; // nro de transferencia, banco, cupón…
  cheque?: {
    numero: string;
    banco?: string;
    titular?: string;
    cuitLibrador?: string;
    fechaEmision?: string;
    fechaCobro?: string; // si es diferido
    diferido?: boolean;
  };
};

export type ReciboDto = {
  clienteId: string;
  imputaciones: { facturaId: string; importe: number }[];
  medios: ReciboMedioDto[];
  concepto?: string;
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

    const { neto, iva, ivaDetalle, total } = this.calcularIvaSeguro(items, tipo);

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
        .select('nombre, punto_venta_arca')
        .eq('id', dto.sucursalId)
        .maybeSingle();
      // Blindaje multi-razón-social: los comprobantes FISCALES solo salen de
      // sucursales con su propia facturación configurada (Santa Inés es otra
      // razón social y todavía no cargó la suya).
      const esFiscal = ['FA', 'FB', 'FC', 'NCA', 'NCB', 'NCC', 'NDA', 'NDB', 'NDC'].includes(tipo);
      if (esFiscal && suc && suc.punto_venta_arca == null) {
        throw new BadRequestException(
          `${suc.nombre} todavía no tiene facturación electrónica configurada (es otra razón social): no se pueden emitir comprobantes fiscales de esa sucursal`,
        );
      }
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
          observaciones: `Anulación de ${TIPOS[c.tipo as TipoComprobante]} ${numeroLindo(c)}`,
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

  // Totales del mes por grupo de comprobante + indicadores (para el resumen)
  async resumen() {
    const inicioMes = new Date();
    inicioMes.setDate(1);
    inicioMes.setHours(0, 0, 0, 0);
    const desde = inicioMes.toISOString();
    const hoy = new Date().toISOString().slice(0, 10);

    const filas: any[] = [];
    for (let d = 0; ; d += 1000) {
      const { data, error } = await this.db
        .from('comprobantes')
        .select('tipo, total, neto, iva, estado, emitido_en')
        .gte('emitido_en', desde)
        .range(d, d + 999);
      if (error) throw new BadRequestException(error.message);
      filas.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }

    const { facturadoHoy, ivaMes, grupos } = agruparResumen(filas, hoy);
    const cuentas = await this.cuentas();
    const porCobrar = Math.round(cuentas.reduce((s, c) => s + Math.max(c.saldo, 0), 0));

    return {
      facturadoHoy,
      ivaMes,
      porCobrar,
      cuentasActivas: cuentas.filter((c) => c.saldo > 0).length,
      grupos,
    };
  }

  async cuentas() {
    // clientes con movimientos: saldo de cada uno (para el tablero de cobranzas)
    const { data, error } = await this.db
      .from('cuenta_corriente')
      .select('cliente_id, debe, haber, cliente:clientes(id, nombre, razon_social, dni, telefono)');
    if (error) throw new BadRequestException(error.message);
    return saldosPorCliente((data ?? []) as any[]);
  }

  // ---------- libro IVA (ventas + compras) ----------

  async libroIva(periodo?: string) {
    const base = periodo && /^\d{4}-\d{2}$/.test(periodo) ? periodo : new Date().toISOString().slice(0, 7);
    const [y, m] = base.split('-').map(Number);
    const desde = `${base}-01T00:00:00`;
    const hasta = new Date(Date.UTC(y, m, 1)).toISOString(); // 1° del mes siguiente

    // ventas: comprobantes fiscales del período (paginado por las dudas)
    const ventasRaw: any[] = [];
    for (let off = 0; ; off += 1000) {
      const { data, error } = await this.db
        .from('comprobantes')
        .select('tipo, punto_venta, numero, emitido_en, receptor, neto, iva, total, iva_detalle, estado')
        .gte('emitido_en', desde)
        .lt('emitido_en', hasta)
        .in('tipo', ['FA', 'FB', 'FC', 'NCA', 'NCB', 'NCC', 'NDA', 'NDB', 'NDC'])
        .range(off, off + 999);
      if (error) throw new BadRequestException(error.message);
      ventasRaw.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }

    // compras: facturas de proveedor del período
    const { data: comprasRaw, error: ec } = await this.db
      .from('facturas_proveedor')
      .select('numero, monto, neto, iva, creado_en, proveedor:proveedores(razon_social, cuit)')
      .gte('creado_en', desde)
      .lt('creado_en', hasta);
    if (ec) throw new BadRequestException(ec.message);

    const ventas = libroIvaVentas(
      ventasRaw.map((c) => ({
        tipo: c.tipo,
        puntoVenta: c.punto_venta,
        numero: c.numero,
        fecha: c.emitido_en,
        receptor: c.receptor,
        neto: Number(c.neto),
        iva: Number(c.iva),
        total: Number(c.total),
        ivaDetalle: c.iva_detalle ?? [],
        estado: c.estado,
      })),
    );
    const compras = libroIvaCompras(
      (comprasRaw ?? []).map((f: any) => ({
        numero: f.numero,
        fecha: f.creado_en,
        proveedor: f.proveedor?.razon_social,
        cuit: f.proveedor?.cuit,
        monto: Number(f.monto),
        neto: f.neto,
        iva: f.iva,
      })),
    );
    return { periodo: base, ventas, compras, resumen: resumenIva(ventas, compras) };
  }

  // ---------- recibos de cobranza (imputación + medios) ----------

  // Facturas/ND en cuenta corriente del cliente con saldo pendiente.
  async facturasAbiertas(clienteId: string) {
    const { data, error } = await this.db.rpc('facturas_abiertas', { p_cliente: clienteId });
    if (error) throw new BadRequestException(error.message);
    return (data ?? []).map((f: any) => ({
      id: f.id,
      tipo: f.tipo,
      etiqueta: `${TIPOS[f.tipo as TipoComprobante] ?? f.tipo} ${numeroLindo(f)}`,
      numero: numeroLindo(f),
      emitidoEn: f.emitido_en,
      total: Number(f.total),
      imputado: Number(f.imputado),
      ncAcreditada: Number(f.nc_acreditada),
      saldo: Number(f.saldo),
    }));
  }

  // Emite un recibo (REC) imputándolo a facturas concretas y registrando los
  // medios de pago. Los cheques de terceros entran a la cartera de valores.
  async emitirRecibo(dto: ReciboDto, usuarioId?: string) {
    if (!dto.clienteId) throw new BadRequestException('El recibo necesita un cliente');
    const imputaciones = (dto.imputaciones ?? []).filter((i) => Number(i.importe) > 0);
    const medios = (dto.medios ?? []).filter((m) => Number(m.importe) > 0);
    if (!imputaciones.length) throw new BadRequestException('Imputá el recibo a al menos una factura');
    if (!medios.length) throw new BadRequestException('Indicá al menos un medio de pago');

    const r2 = (n: number) => Math.round(n * 100) / 100;
    const totalImput = r2(imputaciones.reduce((s, i) => s + Number(i.importe), 0));
    const totalMedios = r2(medios.reduce((s, m) => s + Number(m.importe), 0));
    if (Math.abs(totalImput - totalMedios) > 0.01) {
      throw new BadRequestException(
        `Los medios de pago ($${totalMedios.toLocaleString('es-AR')}) no coinciden con lo imputado ($${totalImput.toLocaleString('es-AR')})`,
      );
    }

    // validar que cada imputación no supere el saldo real de su factura
    const abiertas = await this.facturasAbiertas(dto.clienteId);
    const saldoPorId = new Map<string, number>(abiertas.map((f) => [f.id, f.saldo] as [string, number]));
    for (const im of imputaciones) {
      const saldo = saldoPorId.get(im.facturaId);
      if (saldo == null) throw new BadRequestException('Una de las facturas no está abierta para este cliente');
      if (Number(im.importe) > saldo + 0.01) {
        throw new BadRequestException(`La imputación ($${Number(im.importe).toLocaleString('es-AR')}) supera el saldo de la factura ($${saldo.toLocaleString('es-AR')})`);
      }
    }

    // 1) comprobante REC: numeración + haber en cta cte + notificación al cliente
    const rec = await this.emitir(
      {
        tipo: 'REC',
        clienteId: dto.clienteId,
        importe: totalImput,
        concepto: dto.concepto || 'Cobranza',
        condicionPago: 'contado',
        observaciones: dto.observaciones,
      },
      usuarioId,
    );

    // 2) imputaciones recibo → facturas
    const { error: eImp } = await this.db.from('recibo_imputaciones').insert(
      imputaciones.map((im) => ({ recibo_id: rec.id, factura_id: im.facturaId, importe: Number(im.importe) })),
    );
    if (eImp) throw new BadRequestException(eImp.message);

    // 3) medios de pago (los cheques de terceros entran a cartera)
    for (const m of medios) {
      let chequeId: string | null = null;
      if (m.medio === 'cheque') {
        if (!m.cheque?.numero) throw new BadRequestException('El cheque necesita número');
        const { data: chq, error: eChq } = await this.db
          .from('cheques')
          .insert({
            tipo: 'terceros',
            numero: String(m.cheque.numero),
            banco: m.cheque.banco ?? null,
            titular: m.cheque.titular ?? null,
            cuit_librador: m.cheque.cuitLibrador ?? null,
            importe: Number(m.importe),
            fecha_emision: m.cheque.fechaEmision ?? null,
            fecha_cobro: m.cheque.fechaCobro ?? null,
            es_diferido: !!m.cheque.diferido || !!m.cheque.fechaCobro,
            estado: 'cartera',
            cliente_id: dto.clienteId,
            recibo_id: rec.id,
            usuario_id: usuarioId ?? null,
          })
          .select('id')
          .single();
        if (eChq) throw new BadRequestException(eChq.message);
        chequeId = chq.id;
      }
      const { error: eMed } = await this.db.from('recibo_medios').insert({
        recibo_id: rec.id,
        medio: m.medio,
        importe: Number(m.importe),
        cheque_id: chequeId,
        referencia: m.referencia ?? null,
      });
      if (eMed) throw new BadRequestException(eMed.message);
    }

    return { recibo: rec, total: totalImput, imputaciones: imputaciones.length, medios: medios.length };
  }

  // Detalle de un recibo: a qué facturas se imputó y con qué medios se pagó.
  async detalleRecibo(id: string) {
    const recibo = await this.detalle(id);
    const [{ data: imps }, { data: meds }] = await Promise.all([
      this.db
        .from('recibo_imputaciones')
        .select('importe, factura:comprobantes!recibo_imputaciones_factura_id_fkey(id, tipo, punto_venta, numero, total)')
        .eq('recibo_id', id),
      this.db
        .from('recibo_medios')
        .select('medio, importe, referencia, cheque:cheques(id, numero, banco, fecha_cobro, estado)')
        .eq('recibo_id', id),
    ]);
    return {
      recibo,
      imputaciones: (imps ?? []).map((i: any) => ({
        importe: Number(i.importe),
        factura: i.factura ? { id: i.factura.id, etiqueta: `${TIPOS[i.factura.tipo as TipoComprobante] ?? i.factura.tipo} ${numeroLindo(i.factura)}`, total: Number(i.factura.total) } : null,
      })),
      medios: meds ?? [],
    };
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

  // delega en el motor puro ./iva (testeable) y mapea su error de dominio a HTTP 400
  private calcularIvaSeguro(items: ItemComprobante[], tipo: TipoComprobante) {
    try {
      return calcularIva(items, { forzarSinIva: tipo === 'REM' });
    } catch (e) {
      if (e instanceof RenglonInvalidoError) throw new BadRequestException(e.message);
      throw e;
    }
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
    const etiqueta = `${TIPOS[tipo]} ${numeroLindo(comprobante)}${concepto ? ` · ${concepto}` : ''}`;
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
    // push al celular (si el cliente registró su dispositivo)
    const { data: cli } = await this.db
      .from('clientes')
      .select('expo_push_token')
      .eq('id', clienteId)
      .maybeSingle();
    if (cli?.expo_push_token) {
      await enviarPush(cli.expo_push_token, titulo, cuerpo).catch(() => {});
    }
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
        p_motivo: `Remito ${numeroLindo(comprobante)}`,
        p_usuario_id: usuarioId ?? null,
      });
      if (error) throw new BadRequestException(error.message);
    }
  }
}
