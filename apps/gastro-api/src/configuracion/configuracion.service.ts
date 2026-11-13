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
    cambioBrl?: number | null;
    cambioUsd?: number | null;
    pixModo?: 'terminal' | 'api';
    whatsappDueno?: string | null;
    factorFeriado?: number;
  }) {
    const update: Record<string, any> = {};
    if (patch.nombreRestaurante !== undefined) update.nombre_restaurante = patch.nombreRestaurante;
    if (patch.capacidadAsientos !== undefined) update.capacidad_asientos = patch.capacidadAsientos;
    if (patch.horasServicioDia !== undefined) update.horas_servicio_dia = patch.horasServicioDia;
    if (patch.dosPorUnoActivo !== undefined) update.dos_por_uno_activo = patch.dosPorUnoActivo;
    // El cambio de la casa: cuántos pesos vale un real y un dólar. Se guarda
    // cuándo se cargó, para avisar en caja y en la carta si quedó viejo.
    if (patch.cambioBrl !== undefined || patch.cambioUsd !== undefined) {
      for (const [campo, valor] of [['cambio_brl', patch.cambioBrl], ['cambio_usd', patch.cambioUsd]] as const) {
        if (valor === undefined) continue;
        if (valor !== null && !(Number(valor) > 0)) throw new BadRequestException('El cambio tiene que ser un número mayor que cero');
        update[campo] = valor;
      }
      update.cambio_actualizado_en = new Date().toISOString();
    }
    if (patch.pixModo !== undefined) update.pix_modo = patch.pixModo;
    if (patch.whatsappDueno !== undefined) update.whatsapp_dueno = patch.whatsappDueno?.replace(/\D/g, '') || null;
    if (patch.factorFeriado !== undefined) update.factor_feriado = patch.factorFeriado;
    update.actualizado_en = new Date().toISOString();

    const { data, error } = await this.db.from('configuracion').update(update).eq('id', true).select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }
}
