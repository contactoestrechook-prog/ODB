import { Body, Controller, Delete, Get, Param, Post, Query, Req } from '@nestjs/common';
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
  resumen(@Query('dias') dias?: string, @Query('cuenta') cuenta?: string) {
    return this.mp.resumen(this.dias(dias), this.cuenta(cuenta));
  }

  @Roles('gerente', 'dueno')
  @Get('pagos')
  pagos(@Query('dias') dias?: string, @Query('cuenta') cuenta?: string) {
    return this.mp.pagos(this.dias(dias), this.cuenta(cuenta));
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

  // ── Cobro con QR integrado (la caja manda el importe al QR y espera la aprobación) ──
  @Roles('cajero', 'gerente', 'dueno')
  @Get('cajas-qr')
  cajasQR(@Query('sucursalId') sucursalId: string) {
    return this.mp.cajasQR(sucursalId);
  }

  @Roles('cajero', 'gerente', 'dueno')
  @Post('vincular-caja-qr')
  vincularCajaQR(@Body() b: { cajaId: string; posId?: string | null }) {
    return this.mp.vincularCajaQR(b?.cajaId, b?.posId ?? null);
  }

  @Roles('cajero', 'gerente', 'dueno')
  @Post('cobro-qr')
  cobroQR(@Body() b: { cajaId: string; monto: number; detalle?: string }, @Req() req: any) {
    return this.mp.iniciarCobroQR({ ...(b ?? ({} as any)), usuarioId: req?.user?.sub ?? req?.user?.id });
  }

  @Roles('cajero', 'gerente', 'dueno')
  @Get('cobro-qr/:id')
  estadoCobroQR(@Param('id') id: string) {
    return this.mp.estadoCobroQR(id);
  }

  @Roles('cajero', 'gerente', 'dueno')
  @Delete('cobro-qr/:id')
  cancelarCobroQR(@Param('id') id: string) {
    return this.mp.cancelarCobroQR(id);
  }

  @Roles('cajero', 'gerente', 'dueno')
  @Post('cobro-qr/:id/venta')
  vincularCobroAVenta(@Param('id') id: string, @Body() b: { ventaId: string }) {
    return this.mp.vincularCobroAVenta(id, b?.ventaId);
  }

  private cuenta(v: unknown): string | undefined {
    return v === 'principal' || v === 'santa_ines' ? v : undefined;
  }

  private dias(v: unknown) {
    const n = Math.trunc(Number(v));
    return Number.isFinite(n) && n >= 1 && n <= 90 ? n : 30;
  }
}
