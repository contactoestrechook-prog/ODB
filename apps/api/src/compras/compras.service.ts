import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase.provider';
import { precioDesdeCosto, margenAplicable } from './precio';

export type CrearOcDto = {
  proveedorId: string;
  sucursalId: string;
  // costoUnitario opcional: si falta, se toma el último costo del proveedor
  items: { sku: string; cantidad: number; costoUnitario?: number }[];
  usuarioId?: string;
  fechaEntrega?: string;
  condicionPago?: string;
  vencimientoPago?: string;
  observaciones?: string;
};

export type AprobarDto = { usuarioId?: string; pin?: string };
export type RecibirDto = {
  // costo opcional por renglón = costo REAL de esta entrada (si falta, usa el de la OC)
  // lote/vencimiento opcionales: si vienen, la recepción crea el lote (panel de vencimientos)
  items: { sku: string; cantidad: number; costo?: number; lote?: string; vencimiento?: string }[];
  usuarioId?: string;
  margenPct?: number; // % de remarcación para esta recepción (si falta, usa el del rubro)
};

export type EntradaDirectaDto = {
  proveedorId: string;
  sucursalId: string;
  numeroRemito?: string;
  items: { sku: string; cantidad: number; costo: number; lote?: string; vencimiento?: string }[];
  margenPct?: number;
  usuarioId?: string;
  // si la mercadería vino con factura, se registra junto con la entrada,
  // con su desglose fiscal y vinculada a la OC/remito (nada de facturas flotantes)
  factura?: {
    numero: string;
    total: number;
    neto?: number;
    iva?: number;
    percepcionIva?: number;
    percepcionIibb?: number;
    otros?: number;
    vencimiento?: string;
    pagada?: boolean; // contado en el momento → nace pagada
  };
};

@Injectable()
export class ComprasService {
  constructor(@Inject(SUPABASE) private readonly db: SupabaseClient) {}

  async proveedores() {
    const { data, error } = await this.db
      .from('proveedores')
      .select('id, razon_social, cuit, condicion_pago, lead_time_dias, email')
      .eq('activo', true)
      .order('razon_social');
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async sugerencias() {
    const { data, error } = await this.db
      .from('sugerencias_compra')
      .select('*');
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async ordenes() {
    const { data, error } = await this.db
      .from('ordenes_compra')
      .select(
        `numero, id, estado, total, origen, creado_en, fecha_entrega, condicion_pago, vencimiento_pago, observaciones, descuento, aprobada_en, rechazo_motivo,
         proveedor:proveedores(razon_social),
         sucursal:sucursales(nombre),
         items:ordenes_compra_items(cantidad, cantidad_recibida, costo_unitario, producto:productos(sku, nombre)),
         creador:usuarios!ordenes_compra_creada_por_fkey(nombre)`,
      )
      .order('numero', { ascending: false });
    if (error) throw new BadRequestException(error.message);

    const ids = (data ?? []).map((o: any) => o.id);
    const firmas = new Map<string, string>();
    if (ids.length) {
      const { data: aps } = await this.db
        .from('aprobaciones')
        .select('entidad_id, usuario:usuarios(nombre)')
        .eq('entidad', 'orden_compra')
        .in('entidad_id', ids);
      for (const a of (aps ?? []) as any[]) {
        firmas.set(a.entidad_id, a.usuario?.nombre ?? null);
      }
    }
    return (data ?? []).map((o: any) => ({ ...o, firmadaPor: firmas.get(o.id) ?? null }));
  }

  async crear(dto: CrearOcDto) {
    const items = await Promise.all(
      (dto.items ?? []).map(async (i) => {
        const productoId = await this.productoIdPorSku(i.sku);
        let costo = i.costoUnitario != null ? Number(i.costoUnitario) : null;
        if (costo == null) {
          const { data: pp } = await this.db
            .from('proveedor_productos')
            .select('ultimo_costo')
            .eq('proveedor_id', dto.proveedorId)
            .eq('producto_id', productoId)
            .maybeSingle();
          costo = pp?.ultimo_costo != null ? Number(pp.ultimo_costo) : null;
          if (costo == null) {
            const { data: prod } = await this.db
              .from('productos')
              .select('costo')
              .eq('id', productoId)
              .single();
            costo = Number(prod?.costo ?? 0);
          }
        }
        return { producto_id: productoId, cantidad: Number(i.cantidad), costo_unitario: costo };
      }),
    );
    const { data, error } = await this.db.rpc('crear_orden_compra', {
      p_proveedor: dto.proveedorId,
      p_sucursal: dto.sucursalId,
      p_items: items,
      p_usuario: dto.usuarioId ?? null,
    });
    if (error) throw new BadRequestException(this.traducirError(error.message));
    const ordenCompraId = data;
    const detalle: Record<string, any> = {};
    if (dto.fechaEntrega) detalle.fecha_entrega = dto.fechaEntrega;
    if (dto.condicionPago) detalle.condicion_pago = dto.condicionPago;
    if (dto.vencimientoPago) detalle.vencimiento_pago = dto.vencimientoPago;
    if (dto.observaciones) detalle.observaciones = dto.observaciones;
    if (Object.keys(detalle).length) await this.db.from('ordenes_compra').update(detalle).eq('id', ordenCompraId);
    return { ordenCompraId };
  }

  // Aprobación EXCLUSIVA del dueño (el controller la restringe a rol 'dueno').
  // RPC atómica: la OC nunca queda aprobada sin su registro de auditoría.
  async aprobar(id: string, dto: AprobarDto) {
    const { error } = await this.db.rpc('aprobar_oc_panel', { p_oc: id, p_usuario: dto.usuarioId ?? null });
    if (error) throw new BadRequestException(this.traducirError(error.message));
    return { aprobada: true };
  }

  async rechazar(id: string, dto: { usuarioId?: string; motivo?: string }) {
    const { data: oc } = await this.db.from('ordenes_compra').select('estado').eq('id', id).maybeSingle();
    if (!oc) throw new BadRequestException('No existe la orden de compra');
    if (!['pendiente_aprobacion', 'borrador'].includes(oc.estado)) throw new BadRequestException(`No se puede rechazar una orden "${oc.estado}"`);
    const { error } = await this.db.from('ordenes_compra')
      .update({ estado: 'cancelada', rechazo_motivo: dto.motivo || 'Rechazada por dirección', aprobada_por: dto.usuarioId ?? null, aprobada_en: new Date().toISOString() })
      .eq('id', id);
    if (error) throw new BadRequestException(error.message);
    return { rechazada: true };
  }

  // Recepción + "regla de oro" (costo real → precio de venta) en UNA transacción
  // (RPC recibir_oc_con_precio): no puede quedar stock ingresado con precios viejos.
  async recibir(id: string, dto: RecibirDto) {
    const items = await Promise.all(
      (dto.items ?? []).map(async (i) => ({
        producto_id: await this.productoIdPorSku(i.sku),
        cantidad: Number(i.cantidad),
        lote: i.lote ?? null,
        vencimiento: i.vencimiento ?? null,
      })),
    );
    const itemsPrecio = await this.itemsPrecioRecepcion(id, dto);
    const { data, error } = await this.db.rpc('recibir_oc_con_precio', {
      p_oc: id,
      p_items: items,
      p_items_precio: itemsPrecio,
      p_usuario: dto.usuarioId ?? null,
    });
    if (error) throw new BadRequestException(this.traducirError(error.message));
    return { estado: (data as any).estado, repreciados: Number((data as any).repreciados) || 0 };
  }

  // Entrada directa: la mercadería llegó SIN orden de compra previa (caso diario:
  // compra de oportunidad, reparto que pasa, emergencia). La RPC crea la OC
  // retroactiva con origen 'directa' + remito + stock + lotes + regla de oro,
  // todo en una transacción — con trazabilidad real, sin OC "truchas" a mano.
  async entradaDirecta(dto: EntradaDirectaDto) {
    if (!dto.items?.length) throw new BadRequestException('La entrada no tiene renglones');
    const items = await Promise.all(
      dto.items.map(async (i) => ({
        producto_id: await this.productoIdPorSku(i.sku),
        cantidad: Number(i.cantidad),
        costo_unitario: Number(i.costo) || 0,
        lote: i.lote ?? null,
        vencimiento: i.vencimiento ?? null,
      })),
    );

    // regla de oro con el margen del rubro de cada producto (o el % indicado)
    const skus = dto.items.map((i) => i.sku);
    const { data: prods } = await this.db
      .from('productos')
      .select('sku, categoria:categorias(margen_sugerido)')
      .in('sku', skus);
    const margenPor = new Map<string, number | null>(
      ((prods ?? []) as any[]).map((p) => [p.sku, p.categoria?.margen_sugerido ?? null]),
    );
    const itemsPrecio = dto.items
      .filter((i) => Number(i.costo) > 0)
      .map((i) => {
        const margen = margenAplicable(dto.margenPct, margenPor.get(i.sku) ?? null);
        return { sku: i.sku, costo: Number(i.costo), precio: precioDesdeCosto(Number(i.costo), margen) };
      });

    const { data, error } = await this.db.rpc('recibir_compra_directa', {
      p_proveedor: dto.proveedorId,
      p_sucursal: dto.sucursalId,
      p_items: items,
      p_numero_remito: dto.numeroRemito ?? null,
      p_usuario: dto.usuarioId ?? null,
      p_items_precio: itemsPrecio,
    });
    if (error) throw new BadRequestException(this.traducirError(error.message));
    const resultado = data as any;

    // factura del proveedor: nace vinculada a la OC y al remito de esta entrada,
    // con el desglose de impuestos (IVA, percepciones) para el libro IVA compras
    if (dto.factura?.numero && Number(dto.factura.total) > 0) {
      const f = dto.factura;
      const { error: errF } = await this.db.from('facturas_proveedor').insert({
        proveedor_id: dto.proveedorId,
        numero: f.numero,
        monto: Number(f.total),
        neto: f.neto != null ? Number(f.neto) : null,
        iva: f.iva != null ? Number(f.iva) : null,
        percepcion_iva: Number(f.percepcionIva ?? 0),
        percepcion_iibb: Number(f.percepcionIibb ?? 0),
        otros_impuestos: Number(f.otros ?? 0),
        vencimiento: f.vencimiento ?? null,
        estado: f.pagada ? 'pagada' : 'pendiente',
        oc_id: resultado.oc_id,
        remito_id: resultado.remito_id,
      });
      if (errF) {
        // la entrada ya está registrada (stock movido): no se revierte por la
        // factura — se avisa y se puede cargar desde Compras → Registrar factura
        resultado.facturaError = errF.message;
      } else {
        resultado.factura = { numero: f.numero, total: Number(f.total), estado: f.pagada ? 'pagada' : 'pendiente' };
      }
    }
    return resultado;
  }

  // Calcula los renglones {sku, costo, precio} para la regla de oro. Solo lee la OC
  // (no escribe): la escritura la hace la RPC transaccional junto con la recepción.
  private async itemsPrecioRecepcion(ocId: string, dto: RecibirDto): Promise<{ sku: string; costo: number; precio: number }[]> {
    const { data: oc } = await this.db
      .from('ordenes_compra')
      .select('proveedor_id, items:ordenes_compra_items(costo_unitario, producto:productos(sku, categoria:categorias(margen_sugerido)))')
      .eq('id', ocId)
      .single();
    if (!oc?.proveedor_id) return [];

    const info = new Map<string, { costo: number; margenRubro: number | null }>();
    for (const it of (oc.items ?? []) as any[]) {
      const sku = it.producto?.sku;
      if (sku) info.set(sku, { costo: Number(it.costo_unitario) || 0, margenRubro: it.producto?.categoria?.margen_sugerido ?? null });
    }

    const items: { sku: string; costo: number; precio: number }[] = [];
    for (const r of dto.items ?? []) {
      const i = info.get(r.sku);
      if (!i) continue;
      const costo = r.costo != null && Number(r.costo) > 0 ? Number(r.costo) : i.costo;
      if (!(costo > 0)) continue;
      const margen = margenAplicable(dto.margenPct, i.margenRubro);
      items.push({ sku: r.sku, costo, precio: precioDesdeCosto(costo, margen) });
    }
    return items;
  }

  // ---------- resumen (KPIs) ----------
  async resumen() {
    const inicioMes = new Date();
    inicioMes.setDate(1);
    inicioMes.setHours(0, 0, 0, 0);
    const [ocs, sug, facturas] = await Promise.all([
      this.db.from('ordenes_compra').select('estado, total, creado_en'),
      this.db.from('sugerencias_compra').select('sku'),
      this.db.from('facturas_proveedor').select('monto, estado'),
    ]);
    const o = (ocs.data ?? []) as any[];
    const compradoMes = o
      .filter((x) => !['borrador', 'cancelada'].includes(x.estado) && new Date(x.creado_en) >= inicioMes)
      .reduce((s, x) => s + Number(x.total), 0);
    const deuda = ((facturas.data ?? []) as any[])
      .filter((f) => f.estado !== 'pagada')
      .reduce((s, f) => s + Number(f.monto), 0);
    return {
      compradoMes: Math.round(compradoMes),
      pendientesAprobacion: o.filter((x) => x.estado === 'pendiente_aprobacion').length,
      porRecibir: o.filter((x) => ['aprobada', 'enviada', 'recibida_parcial'].includes(x.estado)).length,
      sugerencias: (sug.data ?? []).length,
      deudaProveedores: Math.round(deuda),
    };
  }

  // ---------- proveedores CRUD ----------
  async crearProveedor(dto: any) {
    if (!dto.razonSocial?.trim()) throw new BadRequestException('La razón social es obligatoria');
    const { data, error } = await this.db
      .from('proveedores')
      .insert({
        razon_social: dto.razonSocial.trim(),
        cuit: dto.cuit || null,
        condicion_pago: dto.condicionPago || null,
        lead_time_dias: Number(dto.leadTimeDias) || 7,
        email: dto.email || null,
        telefono: dto.telefono || null,
      })
      .select('id')
      .single();
    if (error) {
      throw new BadRequestException(error.code === '23505' ? 'Ya existe un proveedor con ese CUIT' : error.message);
    }
    return { id: data.id };
  }

  async editarProveedor(id: string, dto: any) {
    const cambios: Record<string, any> = {};
    if (dto.razonSocial !== undefined) cambios.razon_social = dto.razonSocial;
    if (dto.cuit !== undefined) cambios.cuit = dto.cuit || null;
    if (dto.condicionPago !== undefined) cambios.condicion_pago = dto.condicionPago;
    if (dto.leadTimeDias !== undefined) cambios.lead_time_dias = Number(dto.leadTimeDias) || 7;
    if (dto.email !== undefined) cambios.email = dto.email;
    if (dto.telefono !== undefined) cambios.telefono = dto.telefono;
    if (dto.activo !== undefined) cambios.activo = dto.activo;
    if (!Object.keys(cambios).length) return { ok: true };
    const { error } = await this.db.from('proveedores').update(cambios).eq('id', id);
    if (error) throw new BadRequestException(error.message);
    return { ok: true };
  }

  // ---------- órdenes de pago (cuentas a pagar) ----------
  async deudaProveedores() {
    const { data, error } = await this.db
      .from('facturas_proveedor')
      .select('id, numero, monto, vencimiento, estado, creado_en, proveedor:proveedores(id, razon_social)')
      .not('estado', 'in', '("pagada","en_pago")')
      .order('vencimiento', { ascending: true });
    if (error) throw new BadRequestException(error.message);
    const porProv = new Map<string, any>();
    for (const f of (data ?? []) as any[]) {
      const id = f.proveedor?.id ?? 'sin';
      const acc = porProv.get(id) ?? { proveedor: f.proveedor, total: 0, facturas: [] };
      acc.total += Number(f.monto);
      acc.facturas.push({ id: f.id, numero: f.numero, monto: Number(f.monto), vencimiento: f.vencimiento, estado: f.estado });
      porProv.set(id, acc);
    }
    return [...porProv.values()].map((p) => ({ ...p, total: Math.round(p.total) })).sort((a, b) => b.total - a.total);
  }

  async registrarFactura(dto: any) {
    if (!dto.proveedorId || !dto.numero || !(Number(dto.monto) > 0)) {
      throw new BadRequestException('Proveedor, número y monto son obligatorios');
    }
    const { error } = await this.db.from('facturas_proveedor').insert({
      proveedor_id: dto.proveedorId,
      numero: String(dto.numero),
      monto: Number(dto.monto),
      neto: dto.neto != null && dto.neto !== '' ? Number(dto.neto) : null,
      iva: dto.iva != null && dto.iva !== '' ? Number(dto.iva) : null,
      vencimiento: dto.vencimiento || null,
    });
    if (error) throw new BadRequestException(error.message);
    return { ok: true };
  }

  // 1) Crear orden de pago: queda PENDIENTE de aprobación del dueño (no paga todavía).
  // RPC atómica con lock de facturas: dos OP simultáneas no pueden tomar la misma factura.
  async crearOrdenPago(dto: { facturaIds: string[]; medioPago?: string; vencimiento?: string; fechaProgramada?: string; observaciones?: string; usuarioId?: string }) {
    if (!dto.facturaIds?.length) throw new BadRequestException('Elegí al menos una factura');
    const { data, error } = await this.db.rpc('crear_orden_pago', {
      p_facturas: dto.facturaIds,
      p_medio: dto.medioPago || 'transferencia',
      p_vencimiento: dto.vencimiento || null,
      p_programada: dto.fechaProgramada || null,
      p_observaciones: dto.observaciones || null,
      p_usuario: dto.usuarioId ?? null,
    });
    if (error) throw new BadRequestException(this.traducirError(error.message));
    const r = data as any;
    return { ordenPagoId: r.orden_pago_id, numero: r.numero, total: Math.round(Number(r.total)) };
  }

  // 2) Aprobar OP — EXCLUSIVO del dueño. RPC atómica (estado + auditoría juntos).
  async aprobarOrdenPago(id: string, dto: { usuarioId?: string }) {
    const { error } = await this.db.rpc('aprobar_op_panel', { p_op: id, p_usuario: dto.usuarioId ?? null });
    if (error) throw new BadRequestException(this.traducirError(error.message));
    return { aprobada: true };
  }

  // 3) Rechazar OP — devuelve las facturas a pendiente.
  async rechazarOrdenPago(id: string, dto: { usuarioId?: string; motivo?: string }) {
    const { data: items } = await this.db.from('ordenes_pago_items').select('factura_id').eq('orden_pago_id', id);
    await this.db.from('ordenes_pago').update({ estado: 'rechazada', rechazo_motivo: dto.motivo || 'Rechazada por dirección', aprobada_por: dto.usuarioId ?? null, aprobada_en: new Date().toISOString() }).eq('id', id);
    const fids = (items ?? []).map((i: any) => i.factura_id);
    if (fids.length) await this.db.from('facturas_proveedor').update({ estado: 'pendiente' }).in('id', fids);
    return { rechazada: true };
  }

  // 4) Pagar OP — sólo si está aprobada por el dueño.
  // Opcional: emitir cheques propios y/o endosar cheques de terceros de cartera.
  async pagarOrdenPago(
    id: string,
    dto: {
      usuarioId?: string;
      chequesPropios?: { numero: string; banco?: string; importe: number; fechaCobro?: string; titular?: string }[];
      chequesTercerosIds?: string[];
    },
  ) {
    // RPC atómica: cheques emitidos/endosados + OP pagada + facturas pagadas,
    // todo o nada (no más OP "pagada" con cheques a medias o deuda fantasma).
    const { error } = await this.db.rpc('pagar_orden_pago', {
      p_op: id,
      p_cheques_propios: (dto.chequesPropios ?? []).map((ch) => ({
        numero: String(ch.numero ?? ''),
        banco: ch.banco ?? null,
        titular: ch.titular ?? null,
        importe: Number(ch.importe),
        fechaCobro: ch.fechaCobro ?? null,
      })),
      p_cheques_terceros: dto.chequesTercerosIds ?? [],
      p_usuario: dto.usuarioId ?? null,
    });
    if (error) throw new BadRequestException(this.traducirError(error.message));
    return { pagada: true };
  }

  async ordenesPago() {
    const { data, error } = await this.db
      .from('ordenes_pago')
      .select('id, numero, total, medio_pago, estado, vencimiento, fecha_programada, observaciones, aprobada_en, pagada_en, creado_en, proveedor:proveedores(razon_social)')
      .order('numero', { ascending: false })
      .limit(80);
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
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
