import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase.provider';

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
  items: { sku: string; cantidad: number }[];
  usuarioId?: string;
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
  async aprobar(id: string, dto: AprobarDto) {
    const { data: oc } = await this.db.from('ordenes_compra').select('estado').eq('id', id).maybeSingle();
    if (!oc) throw new BadRequestException('No existe la orden de compra');
    if (oc.estado !== 'pendiente_aprobacion') throw new BadRequestException(`La orden está "${oc.estado}", no se puede aprobar`);
    const { error } = await this.db.from('ordenes_compra')
      .update({ estado: 'aprobada', aprobada_por: dto.usuarioId ?? null, aprobada_en: new Date().toISOString() })
      .eq('id', id);
    if (error) throw new BadRequestException(this.traducirError(error.message));
    await this.db.from('aprobaciones').insert({ entidad: 'orden_compra', entidad_id: id, usuario_id: dto.usuarioId ?? null, metodo: 'panel' });
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

  async recibir(id: string, dto: RecibirDto) {
    const items = await Promise.all(
      (dto.items ?? []).map(async (i) => ({
        producto_id: await this.productoIdPorSku(i.sku),
        cantidad: Number(i.cantidad),
      })),
    );
    const { data, error } = await this.db.rpc('recibir_orden_compra', {
      p_oc: id,
      p_items: items,
      p_usuario: dto.usuarioId ?? null,
    });
    if (error) throw new BadRequestException(this.traducirError(error.message));
    return { estado: data };
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
  async crearOrdenPago(dto: { facturaIds: string[]; medioPago?: string; vencimiento?: string; fechaProgramada?: string; observaciones?: string; usuarioId?: string }) {
    if (!dto.facturaIds?.length) throw new BadRequestException('Elegí al menos una factura');
    const { data: facturas, error: e1 } = await this.db
      .from('facturas_proveedor')
      .select('id, proveedor_id, monto, estado, vencimiento')
      .in('id', dto.facturaIds);
    if (e1) throw new BadRequestException(e1.message);
    const pend = (facturas ?? []).filter((f) => f.estado !== 'pagada' && f.estado !== 'en_pago');
    if (!pend.length) throw new BadRequestException('Esas facturas ya están pagadas o en una OP');
    if (new Set(pend.map((f) => f.proveedor_id)).size > 1) throw new BadRequestException('Las facturas son de distintos proveedores: armá una OP por proveedor');
    const total = pend.reduce((s, f) => s + Number(f.monto), 0);
    const venc = dto.vencimiento || pend.map((f) => f.vencimiento).filter(Boolean).sort()[0] || null;
    const { data: op, error: e2 } = await this.db
      .from('ordenes_pago')
      .insert({
        proveedor_id: pend[0].proveedor_id, total, medio_pago: dto.medioPago || 'transferencia',
        estado: 'pendiente_aprobacion', vencimiento: venc, fecha_programada: dto.fechaProgramada || null,
        observaciones: dto.observaciones || null, creada_por: dto.usuarioId ?? null,
      })
      .select('id, numero')
      .single();
    if (e2) throw new BadRequestException(e2.message);
    await this.db.from('ordenes_pago_items').insert(pend.map((f) => ({ orden_pago_id: op.id, factura_id: f.id, monto: Number(f.monto) })));
    await this.db.from('facturas_proveedor').update({ estado: 'en_pago' }).in('id', pend.map((f) => f.id));
    return { ordenPagoId: op.id, numero: op.numero, total: Math.round(total) };
  }

  // 2) Aprobar OP — EXCLUSIVO del dueño.
  async aprobarOrdenPago(id: string, dto: { usuarioId?: string }) {
    const { data: op } = await this.db.from('ordenes_pago').select('estado').eq('id', id).maybeSingle();
    if (!op) throw new BadRequestException('No existe la orden de pago');
    if (op.estado !== 'pendiente_aprobacion') throw new BadRequestException(`La OP está "${op.estado}"`);
    await this.db.from('ordenes_pago').update({ estado: 'aprobada', aprobada_por: dto.usuarioId ?? null, aprobada_en: new Date().toISOString() }).eq('id', id);
    await this.db.from('aprobaciones').insert({ entidad: 'orden_pago', entidad_id: id, usuario_id: dto.usuarioId ?? null, metodo: 'panel' });
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
    const { data: op } = await this.db.from('ordenes_pago').select('estado, proveedor_id').eq('id', id).maybeSingle();
    if (!op) throw new BadRequestException('No existe la orden de pago');
    if (op.estado !== 'aprobada') throw new BadRequestException('La OP tiene que estar APROBADA por el dueño antes de pagarse');

    // cheques propios: se emiten y quedan a debitar del banco
    for (const ch of dto.chequesPropios ?? []) {
      if (!ch.numero || !(Number(ch.importe) > 0)) throw new BadRequestException('Cada cheque propio necesita número e importe');
      const { error } = await this.db.from('cheques').insert({
        tipo: 'propio', numero: String(ch.numero), banco: ch.banco ?? null, titular: ch.titular ?? null,
        importe: Number(ch.importe), fecha_cobro: ch.fechaCobro ?? null, es_diferido: !!ch.fechaCobro,
        estado: 'emitido', proveedor_id: op.proveedor_id, orden_pago_id: id, usuario_id: dto.usuarioId ?? null,
      });
      if (error) throw new BadRequestException(error.message);
    }
    // cheques de terceros: se endosan al proveedor (salen de cartera)
    for (const chId of dto.chequesTercerosIds ?? []) {
      const { data: chq } = await this.db.from('cheques').select('estado, tipo').eq('id', chId).maybeSingle();
      if (!chq || chq.tipo !== 'terceros') throw new BadRequestException('Cheque de terceros inválido');
      if (chq.estado !== 'cartera') throw new BadRequestException('El cheque de terceros no está en cartera');
      const { error } = await this.db.from('cheques')
        .update({ estado: 'aplicado', proveedor_id: op.proveedor_id, orden_pago_id: id })
        .eq('id', chId);
      if (error) throw new BadRequestException(error.message);
    }

    await this.db.from('ordenes_pago').update({ estado: 'pagada', pagada_en: new Date().toISOString() }).eq('id', id);
    const { data: items } = await this.db.from('ordenes_pago_items').select('factura_id').eq('orden_pago_id', id);
    const fids = (items ?? []).map((i: any) => i.factura_id);
    if (fids.length) await this.db.from('facturas_proveedor').update({ estado: 'pagada' }).in('id', fids);
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
