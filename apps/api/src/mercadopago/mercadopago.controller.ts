import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Query, Req } from '@nestjs/common';
import { MercadoPagoService } from './mercadopago.service';
import { MpReportesService } from './mp-reportes.service';
import { Roles } from '../auth/decorators';

@Controller('mercadopago')
export class MercadoPagoController {
  constructor(private readonly mp: MercadoPagoService, private readonly reportes: MpReportesService) {}

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

  // ── Mes a mes y la plata real (5/11/2026) ──
  @Roles('gerente', 'dueno')
  @Get('mensual')
  mensual(@Query('meses') meses?: string, @Query('cuenta') cuenta?: string) {
    const n = Math.trunc(Number(meses));
    return this.mp.mensual(Number.isFinite(n) && n >= 1 && n <= 36 ? n : 13, this.cuenta(cuenta));
  }

  @Roles('gerente', 'dueno')
  @Get('dias')
  porDia(@Query('desde') desde: string, @Query('hasta') hasta: string, @Query('cuenta') cuenta?: string) {
    return this.mp.dias(this.fecha(desde), this.fecha(hasta), this.cuenta(cuenta));
  }

  @Roles('gerente', 'dueno')
  @Get('liberaciones')
  liberaciones(@Query('desde') desde: string, @Query('hasta') hasta: string, @Query('cuenta') cuenta?: string) {
    return this.mp.liberaciones(this.fecha(desde), this.fecha(hasta), this.cuenta(cuenta));
  }

  @Roles('gerente', 'dueno')
  @Get('pagos-dia')
  pagosDia(@Query('dia') dia: string, @Query('cuenta') cuenta?: string, @Query('tipo') tipo?: string, @Query('por') por?: string) {
    return this.mp.pagosDelDia(this.fecha(dia), this.cuenta(cuenta), /^[a-z_]{2,30}$/.test(tipo ?? '') ? tipo : undefined, por === 'liberacion');
  }

  // La plata real: el extracto de la cuenta (reporte de liberaciones de MP)
  @Roles('gerente', 'dueno')
  @Get('movimientos')
  movimientos(@Query('desde') desde: string, @Query('hasta') hasta: string, @Query('cuenta') cuenta?: string) {
    return this.reportes.movimientos(this.fecha(desde), this.fecha(hasta), this.cuenta(cuenta));
  }

  @Roles('gerente', 'dueno')
  @Get('movimientos-dia')
  movimientosDia(@Query('dia') dia: string, @Query('cuenta') cuenta?: string, @Query('tipo') tipo?: string) {
    return this.reportes.movimientosDelDia(this.fecha(dia), this.cuenta(cuenta), /^[a-z_]{2,40}$/.test(tipo ?? '') ? tipo : undefined);
  }

  private fecha(v: unknown): string {
    if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new BadRequestException('Fecha AAAA-MM-DD');
    return v;
  }

  private cuenta(v: unknown): string | undefined {
    return v === 'principal' || v === 'santa_ines' ? v : undefined;
  }

  private dias(v: unknown) {
    const n = Math.trunc(Number(v));
    return Number.isFinite(n) && n >= 1 && n <= 90 ? n : 30;
  }
}
