import { BadRequestException, Body, Controller, Get, Inject, Post, Req } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase.provider';
import { Roles } from '../auth/decorators';

const TIPOS = ['devolucion', 'consulta', 'pedido', 'reclamo'];

// Lo que el cliente crea y ve desde la app (token con rol 'cliente').
@Roles('cliente')
@Controller('mi')
export class MisSolicitudesController {
  constructor(@Inject(SUPABASE) private readonly db: SupabaseClient) {}

  @Post('solicitudes')
  async crear(
    @Body() body: { tipo?: string; asunto?: string; mensaje?: string },
    @Req() req: any,
  ) {
    const tipo = TIPOS.includes(body.tipo ?? '') ? body.tipo : 'consulta';
    const asunto = (body.asunto ?? '').trim();
    const mensaje = (body.mensaje ?? '').trim();
    if (!mensaje) throw new BadRequestException('Escribí tu mensaje');
    const { data, error } = await this.db
      .from('solicitudes')
      .insert({
        cliente_id: req.usuario.sub,
        tipo,
        asunto: asunto || ETIQUETA(tipo!),
        mensaje,
      })
      .select('id, tipo, asunto, mensaje, estado, creado_en')
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  @Get('solicitudes')
  async mias(@Req() req: any) {
    const { data, error } = await this.db
      .from('solicitudes')
      .select('id, tipo, asunto, mensaje, estado, respuesta, respondido_en, creado_en')
      .eq('cliente_id', req.usuario.sub)
      .order('creado_en', { ascending: false })
      .limit(50);
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }
}

function ETIQUETA(tipo: string) {
  return (
    { devolucion: 'Devolución', consulta: 'Consulta', pedido: 'Pedido especial', reclamo: 'Reclamo' }[
      tipo
    ] ?? 'Mensaje'
  );
}
