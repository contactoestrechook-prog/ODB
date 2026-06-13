import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { FacturacionService, TIPOS } from './facturacion.service';
import type { EmitirDto } from './facturacion.service';
import { Roles } from '../auth/decorators';

// Facturación y administración: cajeros emiten, gerencia anula
@Roles('cajero', 'gerente', 'dueno')
@Controller('facturacion')
export class FacturacionController {
  constructor(private readonly servicio: FacturacionService) {}

  @Get('tipos')
  tipos() {
    return TIPOS;
  }

  @Get('comprobantes')
  listar(@Query() q: { tipo?: string; buscar?: string; desde?: string; hasta?: string; limite?: string; clienteId?: string }) {
    return this.servicio.listar({ ...q, limite: q.limite ? Number(q.limite) : undefined });
  }

  @Get('comprobantes/:id')
  detalle(@Param('id') id: string) {
    return this.servicio.detalle(id);
  }

  @Post('comprobantes')
  emitir(@Body() dto: EmitirDto, @Req() req: any) {
    return this.servicio.emitir(dto, req.usuario?.sub);
  }

  @Roles('gerente', 'dueno')
  @Post('comprobantes/:id/anular')
  anular(@Param('id') id: string, @Req() req: any) {
    return this.servicio.anular(id, req.usuario?.sub);
  }

  @Get('resumen')
  resumen() {
    return this.servicio.resumen();
  }

  @Get('cuentas')
  cuentas() {
    return this.servicio.cuentas();
  }

  @Get('cuentas/:clienteId')
  cuenta(@Param('clienteId') clienteId: string) {
    return this.servicio.cuenta(clienteId);
  }
}
