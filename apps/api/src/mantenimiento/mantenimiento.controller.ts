import { BadRequestException, Body, Controller, Get, Inject, Param, Post, Req } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase.provider';
import { Roles } from '../auth/decorators';
import { resolverCotizacion } from './cotizaciones';

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
    // lo que pasó del abono, cotizado aparte (9/11/2026)
    const { data: cotizaciones, error } = await this.db
      .from('mantenimiento_cotizaciones')
      .select('id, mes, titulo, detalle, horas, precio_hora, moneda, automatica, estado, creada_en, decidida_en, motivo, firmante:usuarios!mantenimiento_cotizaciones_decidida_por_fkey(nombre)')
      .order('creada_en', { ascending: false });
    if (error) throw new BadRequestException(error.message);
    return { horasAbono: HORAS_ABONO, trabajos, cotizaciones: cotizaciones ?? [] };
  }

  // Aprobar o rechazar una cotización. Firma el dueño, como en Aprobaciones.
  @Roles('dueno')
  @Post('cotizaciones/:id/:decision')
  async decidir(@Param('id') id: string, @Param('decision') decision: string, @Body() b: { motivo?: string }, @Req() req: any) {
    if (decision !== 'aprobar' && decision !== 'rechazar') throw new BadRequestException('Decisión inválida');
    const usuarioId: string | undefined = req.usuario?.sub;
    if (!usuarioId) throw new BadRequestException('No pude identificar quién aprueba');
    const r = await resolverCotizacion(this.db, id, decision === 'aprobar', usuarioId, b?.motivo?.trim() || null);
    await this.db.from('auditoria').insert({
      usuario_id: usuarioId, accion: decision === 'aprobar' ? 'aprobacion_firmada' : 'aprobacion_rechazada',
      entidad: 'mantenimiento', entidad_id: id, datos_despues: { decision, motivo: b?.motivo ?? null, desde: 'mantenimiento' },
    }).then(() => null, () => null);
    return { ok: true, ...r };
  }
}
