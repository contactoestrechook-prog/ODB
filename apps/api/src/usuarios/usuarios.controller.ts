import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Req } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase.provider';
import { Roles } from '../auth/decorators';
import { UsuariosService } from './usuarios.service';
import type { CrearUsuarioDto, EditarUsuarioDto } from './usuarios.service';

// Alta, roles y bajas: dueño y gerente. Administración ve el equipo y completa
// nombre, email, WhatsApp y clave (19/11/2026: «que Romina termine de crear los
// usuarios»); el servicio le frena todo lo demás.
@Roles('dueno', 'gerente')
@Controller('usuarios')
export class UsuariosController {
  constructor(
    private readonly servicio: UsuariosService,
    @Inject(SUPABASE) private readonly db: SupabaseClient,
  ) {}

  @Roles('dueno', 'gerente', 'administrativo')
  @Get()
  listar() {
    return this.servicio.listar();
  }

  @Roles('dueno', 'gerente', 'administrativo')
  @Get('sucursales')
  async sucursales() {
    const { data } = await this.db.from('sucursales').select('id, nombre').order('nombre');
    return data ?? [];
  }

  @Post()
  crear(@Body() dto: CrearUsuarioDto, @Req() req: any) {
    return this.servicio.crear(dto, req.usuario);
  }

  @Roles('dueno', 'gerente', 'administrativo')
  @Patch(':id')
  editar(@Param('id') id: string, @Body() dto: EditarUsuarioDto, @Req() req: any) {
    return this.servicio.editar(id, dto, req.usuario);
  }

  @Delete(':id')
  eliminar(@Param('id') id: string, @Req() req: any) {
    return this.servicio.eliminar(id, req.usuario);
  }
}
