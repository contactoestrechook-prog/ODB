import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase.provider';

@Injectable()
export class MozosService {
  constructor(@Inject(SUPABASE) private readonly db: SupabaseClient) {}

  async listar() {
    const { data, error } = await this.db.from('mozos').select('*').order('nombre');
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async crear(nombre: string) {
    const { data, error } = await this.db.from('mozos').insert({ nombre }).select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async actualizar(id: string, activo: boolean) {
    const { data, error } = await this.db.from('mozos').update({ activo }).eq('id', id).select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }
}
