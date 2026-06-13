import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase.provider';

export type AjusteDto = {
  sku: string;
  sucursalId: string;
  cantidad: number;
  motivo: string;
};

export type TransferenciaDto = {
  origenId: string;
  destinoId: string;
  items: { sku: string; cantidad: number }[];
};

@Injectable()
export class StockService {
  constructor(@Inject(SUPABASE) private readonly db: SupabaseClient) {}

  async bajoMinimo() {
    const { data, error } = await this.db.from('stock_critico').select('*');
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async movimientos(filtros: { limite?: number; tipo?: string; sucursalId?: string; sku?: string; dias?: number } = {}) {
    let query = this.db
      .from('movimientos_stock')
      .select(
        'id, tipo, cantidad, motivo, referencia_tipo, creado_en, producto:productos!inner(sku, nombre), sucursal:sucursales(nombre)',
      )
      .order('id', { ascending: false })
      .limit(Math.min(filtros.limite ?? 50, 300));
    if (filtros.tipo) query = query.eq('tipo', filtros.tipo);
    if (filtros.sucursalId) query = query.eq('sucursal_id', filtros.sucursalId);
    if (filtros.sku) query = query.eq('producto.sku', filtros.sku);
    if (filtros.dias) query = query.gte('creado_en', new Date(Date.now() - filtros.dias * 86400_000).toISOString());
    const { data, error } = await query;
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  // ---------- estadísticas (SQL) ----------
  async resumen() {
    const { data, error } = await this.db.rpc('stock_resumen').single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async valorizacion() {
    const [rubros, sucursales] = await Promise.all([
      this.db.rpc('stock_por_rubro'),
      this.db.rpc('stock_por_sucursal'),
    ]);
    if (rubros.error) throw new BadRequestException(rubros.error.message);
    return { rubros: rubros.data ?? [], sucursales: sucursales.data ?? [] };
  }

  async negativos() {
    const { data, error } = await this.db.rpc('stock_negativo');
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async abc() {
    const { data, error } = await this.db.rpc('stock_abc');
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async sinRotacion(dias = 30) {
    const { data, error } = await this.db.rpc('stock_sin_rotacion', { p_dias: dias });
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async registrarAjuste(dto: AjusteDto, tipo: 'ajuste' | 'merma' = 'ajuste') {
    const productoId = await this.productoIdPorSku(dto.sku);
    const cantidad =
      tipo === 'merma' ? -Math.abs(Number(dto.cantidad)) : Number(dto.cantidad);
    const { data, error } = await this.db.rpc('registrar_movimiento', {
      p_producto_id: productoId,
      p_sucursal_id: dto.sucursalId,
      p_tipo: tipo,
      p_cantidad: cantidad,
      p_motivo: dto.motivo,
    });
    if (error) throw new BadRequestException(this.traducirError(error.message));
    return { movimientoId: data };
  }

  async transferenciasPendientes() {
    const { data, error } = await this.db
      .from('transferencias')
      .select(`id, estado, creado_en,
        origen:sucursales!transferencias_sucursal_origen_id_fkey(nombre),
        destino:sucursales!transferencias_sucursal_destino_id_fkey(nombre),
        items:transferencias_items(cantidad, producto:productos(sku, nombre))`)
      .in('estado', ['pendiente', 'en_transito'])
      .order('creado_en', { ascending: false })
      .limit(30);
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async crearTransferencia(dto: TransferenciaDto) {
    const items = await Promise.all(
      (dto.items ?? []).map(async (i) => ({
        producto_id: await this.productoIdPorSku(i.sku),
        cantidad: Number(i.cantidad),
      })),
    );
    const { data, error } = await this.db.rpc('crear_transferencia', {
      p_origen: dto.origenId,
      p_destino: dto.destinoId,
      p_items: items,
    });
    if (error) throw new BadRequestException(this.traducirError(error.message));
    return { transferenciaId: data };
  }

  async recibirTransferencia(id: string) {
    const { error } = await this.db.rpc('recibir_transferencia', {
      p_transferencia: id,
    });
    if (error) throw new BadRequestException(this.traducirError(error.message));
    return { recibida: true };
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
