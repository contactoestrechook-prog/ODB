import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { DescuentosService } from './descuentos.service';
import type { CrearDescuentoDto } from './descuentos.service';
import { Publico, Roles } from '../auth/decorators';

@Controller('descuentos')
export class DescuentosController {
  constructor(private readonly descuentos: DescuentosService) {}

  @Publico()
  @Get()
  listar() {
    return this.descuentos.listar();
  }

  // Ticket promedio y volumen por segmento (guía para targetear promos)
  @Roles('gerente', 'dueno')
  @Get('segmentos')
  segmentos() {
    return this.descuentos.segmentos();
  }

  @Roles('gerente', 'dueno')
  @Post()
  crear(@Body() dto: CrearDescuentoDto) {
    return this.descuentos.crear(dto);
  }

  // Activar / pausar una promoción
  @Roles('gerente', 'dueno')
  @Patch(':id')
  cambiarEstado(@Param('id') id: string, @Body() body: { activo: boolean }) {
    return this.descuentos.cambiarEstado(id, body.activo);
  }
}
