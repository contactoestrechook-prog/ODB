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

  async movimientos(limite = 50) {
    const { data, error } = await this.db
      .from('movimientos_stock')
      .select(
        'id, tipo, cantidad, motivo, referencia_tipo, creado_en, producto:productos(sku, nombre), sucursal:sucursales(nombre)',
      )
      .order('id', { ascending: false })
      .limit(Math.min(limite, 200));
    if (error) throw new BadRequestException(error.message);
    return data;
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
