import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase.provider';

@Injectable()
export class SyncService {
  constructor(@Inject(SUPABASE) private readonly db: SupabaseClient) {}

  // Estado del bridge legacy → Supabase: última corrida + historial reciente.
  async estado() {
    const { data, error } = await this.db
      .from('sync_runs')
      .select('corrida_en, duracion_ms, productos_leidos, productos_actualizados, clientes_leidos, clientes_actualizados, ok, error')
      .order('corrida_en', { ascending: false })
      .limit(15);
    if (error) throw new BadRequestException(error.message);
    return { ultima: data?.[0] ?? null, historial: data ?? [] };
  }
}
