import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { VentasService } from './ventas.service';
import type { CrearVentaDto } from './ventas.service';
import { Roles } from '../auth/decorators';

@Controller('ventas')
export class VentasController {
  constructor(private readonly ventas: VentasService) {}

  @Roles('cajero', 'gerente', 'dueno')
  @Post()
  registrar(@Body() dto: CrearVentaDto) {
    return this.ventas.registrar(dto);
  }

  @Get()
  listar(@Query('limite') limite?: string) {
    return this.ventas.listar(limite ? Number(limite) : undefined);
  }

  @Get('resumen')
  resumen() {
    return this.ventas.resumenHoy();
  }

  @Get('cliente/:dni')
  cliente(@Param('dni') dni: string) {
    return this.ventas.clientePorDni(dni);
  }
}
