import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Req } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE } from '../supabase.provider';
import { Roles } from '../auth/decorators';
import { UsuariosService } from './usuarios.service';
import type { CrearUsuarioDto, EditarUsuarioDto } from './usuarios.service';

@Roles('dueno', 'gerente')
@Controller('usuarios')
export class UsuariosController {
  constructor(
    private readonly servicio: UsuariosService,
    @Inject(SUPABASE) private readonly db: SupabaseClient,
  ) {}

  @Get()
  listar() {
    return this.servicio.listar();
  }

  @Get('sucursales')
  async sucursales() {
    const { data } = await this.db.from('sucursales').select('id, nombre').order('nombre');
    return data ?? [];
  }

  @Post()
  crear(@Body() dto: CrearUsuarioDto, @Req() req: any) {
    return this.servicio.crear(dto, req.usuario);
  }

  @Patch(':id')
  editar(@Param('id') id: string, @Body() dto: EditarUsuarioDto, @Req() req: any) {
    return this.servicio.editar(id, dto, req.usuario);
  }

  @Delete(':id')
  eliminar(@Param('id') id: string, @Req() req: any) {
    return this.servicio.eliminar(id, req.usuario);
  }
}
