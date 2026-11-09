import { BadRequestException, Controller, Get, Inject } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase.provider';
import { Roles } from '../auth/decorators';

// MANTENIMIENTO (Leandro, 9/11/2026: «6 horas de programación de mantenimiento
// mensuales… qué hicimos, sobre qué trabajamos, qué se mejoró, si fueron
// arreglos, bugs, propuestas o mejoras, quién las pidió, cuándo y todo»).
// Cada trabajo publicado lo carga scripts/mantenimiento-sync.mjs al final de
// cada publicación (db/migracion-mantenimiento.sql). Acá solo se lee.
export const HORAS_ABONO = Number(process.env.MANTENIMIENTO_HORAS_MES ?? 6);

const COLUMNAS = 'hash, publicado_en, mes, tipo, area, titulo, que_se_hizo, para_que, pidio, pedido_el, cita, mensaje, minutos, partes, archivos, lineas';

@Controller('mantenimiento')
export class MantenimientoController {
  constructor(@Inject(SUPABASE) private readonly db: SupabaseClient) {}

  // Todos los trabajos (son cientos, no miles): la pantalla agrupa y filtra sin
  // volver a pedir. De a 1.000 porque Supabase corta ahí.
  @Roles('gerente', 'dueno')
  @Get()
  async listar() {
    const trabajos: any[] = [];
    for (let desde = 0; ; desde += 1000) {
      const { data, error } = await this.db
        .from('mantenimiento_trabajos')
        .select(COLUMNAS)
        .order('publicado_en', { ascending: false })
        .range(desde, desde + 999);
      if (error) throw new BadRequestException(error.message);
      trabajos.push(...(data ?? []));
      if ((data ?? []).length < 1000) break;
    }
    return { horasAbono: HORAS_ABONO, trabajos };
  }
}
