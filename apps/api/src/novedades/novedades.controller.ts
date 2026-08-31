import { BadRequestException, Body, Controller, Get, Inject, Param, Post, Req } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase.provider';
import { Roles } from '../auth/decorators';

// Novedades del sistema: cada actualización deja escrito qué cambió, y el
// panel se lo muestra a cada persona una sola vez, con el botón para recargar.
@Controller('novedades')
export class NovedadesController {
  constructor(@Inject(SUPABASE) private readonly db: SupabaseClient) {}

  // Lo que el usuario logueado todavía no vio
  @Get('pendientes')
  async pendientes(@Req() req: any) {
    const { data, error } = await this.db.rpc('novedades_pendientes', { p_usuario: req.usuario.sub });
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  // La persona la leyó (o recargó): no se le muestra más
  @Post(':id/vista')
  async vista(@Param('id') id: string, @Req() req: any) {
    const { error } = await this.db
      .from('novedades_vistas')
      .upsert({ usuario_id: req.usuario.sub, novedad_id: id }, { onConflict: 'usuario_id,novedad_id' });
    if (error) throw new BadRequestException(error.message);
    return { ok: true };
  }

  // ---- Alertas internas (la campanita): lo que el sistema le avisa a cada persona ----

  // Alertas sin leer: las dirigidas a mí + las generales (para dueños/gerentes)
  @Get('alertas')
  async alertas(@Req() req: any) {
    const esJefe = ['dueno', 'gerente'].includes(req.usuario.rol);
    let q = this.db.from('alertas_internas').select('*').is('leida_en', null).order('creada_en', { ascending: false }).limit(50);
    q = esJefe ? q.or(`para_usuario.eq.${req.usuario.sub},para_usuario.is.null`) : q.eq('para_usuario', req.usuario.sub);
    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  // Avisarle a UNA persona que se arregló algo. La novedad del panel la ve todo
  // el equipo una vez y responde "qué cambió en esta versión"; esto le queda en
  // la campanita a quien corresponda hasta que la lee. Juan Pablo pidió que
  // cada arreglo le llegue así, porque no está mirando el panel todo el día.
  @Roles('dueno')
  @Post('alertas')
  async crearAlerta(
    @Body() b: { paraUsuario?: string; tipo?: string; titulo: string; detalle?: string; referencia?: any },
    @Req() req: any,
  ) {
    if (!b?.titulo?.trim()) throw new BadRequestException('Falta el título del aviso');
    const { error } = await this.db.from('alertas_internas').insert({
      para_usuario: b.paraUsuario ?? null,
      tipo: b.tipo?.trim() || 'arreglo',
      titulo: b.titulo.trim(),
      detalle: b.detalle?.trim() || null,
      referencia: b.referencia ?? { origen: 'deploy', por: req.usuario?.sub ?? null },
    });
    if (error) throw new BadRequestException(error.message);
    return { ok: true };
  }

  @Post('alertas/:id/leida')
  async alertaLeida(@Param('id') id: string, @Req() req: any) {
    const { error } = await this.db.from('alertas_internas')
      .update({ leida_en: new Date().toISOString() })
      .eq('id', id)
      .or(`para_usuario.eq.${req.usuario.sub},para_usuario.is.null`);
    if (error) throw new BadRequestException(error.message);
    return { ok: true };
  }

  // Publicar una novedad. Lo usa el deploy (con token de dueño) o el dueño a mano.
  @Roles('dueno')
  @Post()
  async publicar(@Body() b: { version: string; titulo: string; detalle?: string[]; requiereRecarga?: boolean }) {
    if (!b?.version?.trim() || !b?.titulo?.trim()) throw new BadRequestException('Falta versión o título');
    const { data, error } = await this.db
      .from('novedades_sistema')
      .upsert(
        {
          version: b.version.trim(),
          titulo: b.titulo.trim(),
          detalle: (b.detalle ?? []).map((d) => String(d).trim()).filter(Boolean),
          requiere_recarga: b.requiereRecarga !== false,
        },
        { onConflict: 'version' },
      )
      .select('id, version')
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }
}
