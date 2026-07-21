import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { Roles } from '../auth/decorators';
import { ListasVentaService } from './listas-venta.service';

@Roles('gerente', 'dueno')
@Controller('listas-venta')
export class ListasVentaController {
  constructor(private readonly serv: ListasVentaService) {}

  @Get()
  listar() {
    return this.serv.listar();
  }

  @Patch(':id')
  editar(@Param('id') id: string, @Body() dto: { nombre?: string; ajustePct?: number; activa?: boolean }) {
    return this.serv.editar(id, dto);
  }

  @Post(':id/regenerar')
  regenerar(@Param('id') id: string) {
    return this.serv.regenerar(id);
  }
}
