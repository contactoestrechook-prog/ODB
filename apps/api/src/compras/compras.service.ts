import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase.provider';

export type CrearOcDto = {
  proveedorId: string;
  sucursalId: string;
  // costoUnitario opcional: si falta, se toma el último costo del proveedor
  items: { sku: string; cantidad: number; costoUnitario?: number }[];
  usuarioId?: string;
};

export type AprobarDto = { usuarioId: string; pin: string };
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
        `numero, id, estado, total, origen, creado_en,
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
    return { ordenCompraId: data };
  }

  async aprobar(id: string, dto: AprobarDto) {
    const { error } = await this.db.rpc('aprobar_orden_compra', {
      p_oc: id,
      p_usuario: dto.usuarioId,
      p_pin: dto.pin,
    });
    if (error) throw new BadRequestException(this.traducirError(error.message));
    return { aprobada: true };
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
      .neq('estado', 'pagada')
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
      vencimiento: dto.vencimiento || null,
    });
    if (error) throw new BadRequestException(error.message);
    return { ok: true };
  }

  async pagar(dto: { facturaIds: string[]; medioPago?: string; usuarioId?: string }) {
    if (!dto.facturaIds?.length) throw new BadRequestException('Elegí al menos una factura');
    const { data: facturas, error: e1 } = await this.db
      .from('facturas_proveedor')
      .select('id, proveedor_id, monto, estado')
      .in('id', dto.facturaIds);
    if (e1) throw new BadRequestException(e1.message);
    const pend = (facturas ?? []).filter((f) => f.estado !== 'pagada');
    if (!pend.length) throw new BadRequestException('Esas facturas ya están pagadas');
    const total = pend.reduce((s, f) => s + Number(f.monto), 0);
    const { data: op, error: e2 } = await this.db
      .from('ordenes_pago')
      .insert({
        proveedor_id: pend[0].proveedor_id,
        total,
        medio_pago: dto.medioPago || 'transferencia',
        estado: 'pagada',
        pagada_en: new Date().toISOString(),
        creada_por: dto.usuarioId ?? null,
      })
      .select('id')
      .single();
    if (e2) throw new BadRequestException(e2.message);
    await this.db.from('ordenes_pago_items').insert(
      pend.map((f) => ({ orden_pago_id: op.id, factura_id: f.id, monto: Number(f.monto) })),
    );
    await this.db.from('facturas_proveedor').update({ estado: 'pagada' }).in('id', pend.map((f) => f.id));
    return { ordenPagoId: op.id, total: Math.round(total) };
  }

  async ordenesPago() {
    const { data, error } = await this.db
      .from('ordenes_pago')
      .select('numero, total, medio_pago, estado, pagada_en, creado_en, proveedor:proveedores(razon_social)')
      .order('numero', { ascending: false })
      .limit(50);
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
