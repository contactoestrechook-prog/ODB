import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { MercadoPagoService } from './mercadopago.service';
import { Roles } from '../auth/decorators';

@Controller('mercadopago')
export class MercadoPagoController {
  constructor(private readonly mp: MercadoPagoService) {}

  @Roles('gerente', 'dueno')
  @Get('estado')
  estado() {
    return this.mp.estado();
  }

  @Roles('gerente', 'dueno')
  @Get('resumen')
  resumen(@Query('dias') dias?: string) {
    return this.mp.resumen(this.dias(dias));
  }

  @Roles('gerente', 'dueno')
  @Get('pagos')
  pagos(@Query('dias') dias?: string) {
    return this.mp.pagos(this.dias(dias));
  }

  @Roles('gerente', 'dueno')
  @Post('importar')
  importar(@Body() b: { dias?: number }) {
    return this.mp.importar(this.dias(b?.dias));
  }

  // El cajero también puede generar un link para cobrar a distancia
  @Roles('cajero', 'gerente', 'dueno')
  @Post('link')
  link(@Body() b: { monto: number; concepto?: string; sucursalId?: string }) {
    return this.mp.crearLink(b ?? ({} as any));
  }

  private dias(v: unknown) {
    const n = Math.trunc(Number(v));
    return Number.isFinite(n) && n >= 1 && n <= 90 ? n : 30;
  }
}
