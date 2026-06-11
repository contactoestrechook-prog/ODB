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
