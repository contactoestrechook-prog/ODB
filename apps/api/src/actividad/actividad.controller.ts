import { BadRequestException, Controller, Get, Inject, Query } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase.provider';
import { Roles } from '../auth/decorators';

// QUIÉN HIZO QUÉ (Leandro, 6/10/2026: "en dónde nos quedan los datos de quién
// hizo cada cosa"). Los datos estaban desparramados en una veintena de tablas;
// actividad_equipo() (db/migracion-actividad-equipo.sql) los junta y acá se les
// pone el nombre de cada persona. Solo lectura, solo dueño y gerente.
export type FilaActividad = { cuando: string; usuarioId: string; quien: string; area: string; accion: string; detalle: string | null; link: string | null };

/** Desde/hasta de la consulta: por defecto la última semana; nunca más de 92 días. */
export function rangoActividad(desde?: string, hasta?: string, ahora = new Date()): { desde: Date; hasta: Date } {
  const h = hasta && !Number.isNaN(Date.parse(hasta)) ? new Date(hasta) : ahora;
  let d = desde && !Number.isNaN(Date.parse(desde)) ? new Date(desde) : new Date(h.getTime() - 7 * 86400_000);
  if (d > h) d = new Date(h.getTime() - 7 * 86400_000);
  if (h.getTime() - d.getTime() > 92 * 86400_000) d = new Date(h.getTime() - 92 * 86400_000);
  return { desde: d, hasta: h };
}

@Controller('actividad')
export class ActividadController {
  constructor(@Inject(SUPABASE) private readonly db: SupabaseClient) {}

  @Roles('gerente', 'dueno')
  @Get()
  async listar(@Query('desde') desde?: string, @Query('hasta') hasta?: string, @Query('usuario') usuario?: string, @Query('area') area?: string) {
    const r = rangoActividad(desde, hasta);
    const [{ data, error }, { data: usuarios }] = await Promise.all([
      this.db.rpc('actividad_equipo', { p_desde: r.desde.toISOString(), p_hasta: r.hasta.toISOString() }),
      this.db.from('usuarios').select('id, nombre, rol, activo'),
    ]);
    if (error) throw new BadRequestException(error.message);
    const nombres = new Map(((usuarios ?? []) as any[]).map((u) => [String(u.id), String(u.nombre ?? '')]));
    const todas: FilaActividad[] = ((data ?? []) as any[])
      .map((f) => ({
        cuando: f.cuando,
        usuarioId: String(f.usuario_id),
        quien: nombres.get(String(f.usuario_id)) ?? 'alguien del equipo',
        area: f.area,
        accion: f.accion,
        detalle: f.detalle || null,
        link: f.link || null,
      }))
      .sort((a, b) => Date.parse(b.cuando) - Date.parse(a.cuando));
    const filas = todas.filter((f) => (!usuario || f.usuarioId === usuario) && (!area || f.area === area));
    return {
      desde: r.desde.toISOString(),
      hasta: r.hasta.toISOString(),
      filas: filas.slice(0, 1000),
      recortado: filas.length > 1000,
      // para los filtros: quiénes y qué áreas aparecen en el período
      personas: [...new Map(todas.map((f) => [f.usuarioId, f.quien])).entries()].map(([id, nombre]) => ({ id, nombre })).sort((a, b) => a.nombre.localeCompare(b.nombre)),
      areas: [...new Set(todas.map((f) => f.area))].sort(),
    };
  }
}
