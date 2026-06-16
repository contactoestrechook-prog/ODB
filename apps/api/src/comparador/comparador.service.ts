import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase.provider';

@Injectable()
export class ComparadorService {
  constructor(@Inject(SUPABASE) private readonly db: SupabaseClient) {}

  async comparar() {
    const { data, error } = await this.db.rpc('comparar_proveedores', { p_min: 2 });
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async proveedores() {
    const { data, error } = await this.db
      .from('proveedores')
      .select('id, razon_social, condicion_pago, descuento_efectivo, activo')
      .order('razon_social');
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async guardarTerminos(id: string, condicionPago?: string, descuentoEfectivo?: number) {
    const desc = Number(descuentoEfectivo);
    const patch: any = {};
    if (condicionPago !== undefined) patch.condicion_pago = condicionPago || null;
    if (descuentoEfectivo !== undefined) {
      if (!Number.isFinite(desc) || desc < 0 || desc > 100) throw new BadRequestException('Descuento inválido');
      patch.descuento_efectivo = desc;
    }
    const { error } = await this.db.from('proveedores').update(patch).eq('id', id);
    if (error) throw new BadRequestException(error.message);
    return { ok: true };
  }
}
