import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
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
  listar(
    @Query('limite') limite?: string,
    @Query('estado') estado?: string,
    @Query('sucursalId') sucursalId?: string,
    @Query('medioPago') medioPago?: string,
    @Query('dias') dias?: string,
    @Query('buscar') buscar?: string,
  ) {
    return this.ventas.listar({
      limite: limite ? Number(limite) : undefined,
      estado: estado || undefined,
      sucursalId: sucursalId || undefined,
      medioPago: medioPago || undefined,
      dias: dias ? Number(dias) : undefined,
      buscar: buscar || undefined,
    });
  }

  @Get('resumen')
  resumen() {
    return this.ventas.resumenHoy();
  }

  @Get('cliente/:dni')
  cliente(@Param('dni') dni: string) {
    return this.ventas.clientePorDni(dni);
  }

  // Anular es sensible: solo gerencia, queda auditado y emite nota de crédito
  @Roles('gerente', 'dueno')
  @Post(':id/anular')
  anular(@Param('id') id: string, @Req() req: any) {
    return this.ventas.anular(id, req.usuario?.sub);
  }
}
