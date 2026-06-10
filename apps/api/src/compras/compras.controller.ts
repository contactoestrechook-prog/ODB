import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ComprasService } from './compras.service';
import type { AprobarDto, CrearOcDto, RecibirDto } from './compras.service';
import { Roles } from '../auth/decorators';

@Controller()
export class ComprasController {
  constructor(private readonly compras: ComprasService) {}

  @Get('proveedores')
  proveedores() {
    return this.compras.proveedores();
  }

  @Get('compras/sugerencias')
  sugerencias() {
    return this.compras.sugerencias();
  }

  @Get('compras/ordenes')
  ordenes() {
    return this.compras.ordenes();
  }

  @Roles('comprador', 'gerente', 'dueno')
  @Post('compras/ordenes')
  crear(@Body() dto: CrearOcDto) {
    return this.compras.crear(dto);
  }

  @Roles('gerente', 'dueno')
  @Post('compras/ordenes/:id/aprobar')
  aprobar(@Param('id') id: string, @Body() dto: AprobarDto) {
    return this.compras.aprobar(id, dto);
  }

  @Roles('deposito', 'gerente', 'dueno')
  @Post('compras/ordenes/:id/recibir')
  recibir(@Param('id') id: string, @Body() dto: RecibirDto) {
    return this.compras.recibir(id, dto);
  }
}
