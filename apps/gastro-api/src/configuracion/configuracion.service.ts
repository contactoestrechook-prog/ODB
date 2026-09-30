import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase.provider';

@Injectable()
export class ConfiguracionService {
  constructor(@Inject(SUPABASE) private readonly db: SupabaseClient) {}

  // Fila única (id=true, forzado por check constraint) — no hace falta
  // manejar múltiples locales todavía.
  async obtener() {
    const { data, error } = await this.db.from('configuracion').select('*').eq('id', true).single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async actualizar(patch: {
    nombreRestaurante?: string;
    capacidadAsientos?: number;
    horasServicioDia?: number;
    dosPorUnoActivo?: boolean;
  }) {
    const update: Record<string, any> = {};
    if (patch.nombreRestaurante !== undefined) update.nombre_restaurante = patch.nombreRestaurante;
    if (patch.capacidadAsientos !== undefined) update.capacidad_asientos = patch.capacidadAsientos;
    if (patch.horasServicioDia !== undefined) update.horas_servicio_dia = patch.horasServicioDia;
    if (patch.dosPorUnoActivo !== undefined) update.dos_por_uno_activo = patch.dosPorUnoActivo;
    update.actualizado_en = new Date().toISOString();

    const { data, error } = await this.db.from('configuracion').update(update).eq('id', true).select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }
}
