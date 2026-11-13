import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { DerivadoresService } from './derivadores.service';
import type { DerivadorInput } from './derivadores.service';
import { Publico } from '../auth/decorators';

@Controller()
export class DerivadoresController {
  constructor(private readonly derivadores: DerivadoresService) {}

  @Publico()
  @Get('r/:codigo')
  publico(@Param('codigo') codigo: string) {
    return this.derivadores.publico(codigo);
  }

  @Get('admin/derivadores')
  listar(@Query('mes') mes?: string) {
    return this.derivadores.listar(mes || undefined);
  }

  @Post('admin/derivadores')
  crear(@Body() body: DerivadorInput) {
    return this.derivadores.crear(body);
  }

  @Get('admin/derivadores/:id')
  detalle(@Param('id') id: string, @Query('mes') mes?: string) {
    return this.derivadores.detalle(id, mes || undefined);
  }

  @Put('admin/derivadores/:id')
  actualizar(@Param('id') id: string, @Body() body: Partial<DerivadorInput>) {
    return this.derivadores.actualizar(id, body);
  }

  @Post('admin/derivadores/:id/pagar')
  pagar(@Param('id') id: string, @Body() body: { mes: string; nota?: string }) {
    return this.derivadores.pagarComision(id, body.mes, body.nota);
  }

  @Delete('admin/derivadores/:id/pagar')
  deshacerPago(@Param('id') id: string, @Query('mes') mes: string) {
    return this.derivadores.deshacerPago(id, mes);
  }

  @Get('admin/derivadores/:id/whatsapp')
  whatsapp(@Param('id') id: string, @Query('mes') mes?: string) {
    return this.derivadores.resumenWhatsapp(id, mes || undefined);
  }
}
