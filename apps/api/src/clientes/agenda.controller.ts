import { BadRequestException, Body, Controller, Get, Inject, Param, Patch, Query } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase.provider';
import { Roles } from '../auth/decorators';
import { celularWhatsapp } from '../comun/whatsapp';

// Agenda (Leandro, 24/10/2026): dentro de Clientes, todos los que escribieron
// a las líneas de WhatsApp, con su nombre y su número, para llamar o escribir
// con un toque. Sale de bot_contactos: el bot anota a cada uno que escribe.
// telefono es la clave del chat (a veces un @lid sin número); el número que
// se marca es telefono_real cuando está.
@Controller('agenda')
export class AgendaController {
  constructor(@Inject(SUPABASE) private readonly db: SupabaseClient) {}

  @Roles('gerente', 'dueno')
  @Get()
  async listar(@Query('buscar') buscar?: string, @Query('tipo') tipo?: string, @Query('pagina') paginaParam?: string) {
    const porPagina = 60;
    const pagina = Math.max(Number(paginaParam ?? 1) || 1, 1);
    let q = this.db
      .from('bot_contactos')
      .select('telefono, telefono_real, nombre, nombre_wa, tipo, etiquetas, es_equipo, actualizado_en', { count: 'exact' })
      .order('actualizado_en', { ascending: false, nullsFirst: false });
    if (tipo === 'proveedores') q = q.eq('tipo', 'proveedor');
    else if (tipo === 'equipo') q = q.eq('es_equipo', true);
    else if (tipo === 'clientes') q = q.neq('tipo', 'proveedor').eq('es_equipo', false);
    const b = String(buscar ?? '').trim().replace(/[%,()]/g, ' ');
    if (b) {
      const digitos = b.replace(/\D/g, '');
      const filtros = [`nombre.ilike.%${b}%`, `nombre_wa.ilike.%${b}%`];
      if (digitos.length >= 4) filtros.push(`telefono_real.ilike.%${digitos}%`, `telefono.ilike.%${digitos}%`);
      q = q.or(filtros.join(','));
    }
    const { data, count, error } = await q.range((pagina - 1) * porPagina, pagina * porPagina - 1);
    if (error) throw new BadRequestException(error.message);

    return {
      total: count ?? 0,
      pagina,
      paginas: Math.max(Math.ceil((count ?? 0) / porPagina), 1),
      items: (data ?? []).map((c: any) => {
        const numero = celularWhatsapp(String(c.telefono_real ?? (/@lid$/.test(c.telefono) ? '' : c.telefono) ?? ''));
        return {
          id: c.telefono,
          nombre: String(c.nombre ?? '').trim() || null,
          nombreWhatsapp: String(c.nombre_wa ?? '').trim() || null,
          numero: numero.length >= 10 ? numero : null,
          tipo: c.es_equipo ? 'equipo' : c.tipo === 'proveedor' ? 'proveedor' : 'cliente',
          etiquetas: c.etiquetas ?? [],
          ultimoMensaje: c.actualizado_en,
        };
      }),
    };
  }

  // corregir el nombre con el que se lo ve (es el mismo bot_contactos.nombre que lee el bot)
  @Roles('gerente', 'dueno')
  @Patch(':id')
  async renombrar(@Param('id') id: string, @Body() dto: { nombre?: string }) {
    const nombre = String(dto.nombre ?? '').trim();
    if (nombre.length > 80) throw new BadRequestException('El nombre es demasiado largo');
    const { error } = await this.db.from('bot_contactos').update({ nombre: nombre || null }).eq('telefono', id);
    if (error) throw new BadRequestException(error.message);
    return { ok: true };
  }
}
