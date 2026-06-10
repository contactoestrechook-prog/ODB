import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase.provider';

export type CrearDescuentoDto = {
  nombre: string;
  alcance: 'global' | 'categoria' | 'marca' | 'producto';
  tipo: 'porcentaje' | 'monto_fijo' | 'precio_fijo';
  valor: number;
  desde: string;
  hasta: string;
  categoriaId?: string;
  marcaId?: string;
  sku?: string;
  segmento?: string;
  medioPago?: string;
  combinable?: boolean;
};

@Injectable()
export class DescuentosService {
  constructor(@Inject(SUPABASE) private readonly db: SupabaseClient) {}

  async listar() {
    const { data, error } = await this.db
      .from('descuentos')
      .select(
        '*, categoria:categorias(nombre), marca:marcas(nombre), producto:productos(sku, nombre)',
      )
      .order('desde', { ascending: false });
    if (error) throw new BadRequestException(error.message);
    const ahora = new Date().toISOString();
    return (data ?? []).map((d) => ({
      ...d,
      estado: !d.activo
        ? 'inactivo'
        : ahora < d.desde
          ? 'programado'
          : ahora > d.hasta
            ? 'vencido'
            : 'vigente',
    }));
  }

  async crear(dto: CrearDescuentoDto) {
    let productoId: string | null = null;
    if (dto.alcance === 'producto') {
      const { data } = await this.db
        .from('productos')
        .select('id')
        .eq('sku', dto.sku ?? '')
        .maybeSingle();
      if (!data) throw new BadRequestException(`No existe el producto ${dto.sku}`);
      productoId = data.id;
    }
    const { data, error } = await this.db
      .from('descuentos')
      .insert({
        nombre: dto.nombre,
        alcance: dto.alcance,
        tipo: dto.tipo,
        valor: dto.valor,
        desde: dto.desde,
        hasta: dto.hasta,
        categoria_id: dto.categoriaId ?? null,
        marca_id: dto.marcaId ?? null,
        producto_id: productoId,
        segmento: dto.segmento ?? null,
        medio_pago: dto.medioPago ?? null,
        combinable: dto.combinable ?? false,
      })
      .select('id')
      .single();
    if (error) {
      const msg = error.message.includes('row-level security')
        ? 'El backend no tiene permisos de escritura: falta la SUPABASE_SERVICE_KEY en apps/api/.env'
        : error.message;
      throw new BadRequestException(msg);
    }
    return { descuentoId: data.id };
  }
}
