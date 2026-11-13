import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CuentaService } from './cuenta.service';
import type { Metodo, Moneda } from './cuenta.service';
import { Publico } from '../auth/decorators';

@Controller()
export class CuentaController {
  constructor(private readonly cuenta: CuentaService) {}

  // ── público: el cliente desde el QR de su mesa ──

  @Publico()
  @Get('monedas')
  monedas() {
    return this.cuenta.cambio();
  }

  @Publico()
  @Get('mesas/:token/cuenta')
  cuentaDelCliente(@Param('token') token: string) {
    return this.cuenta.cuentaPorToken(token);
  }

  @Publico()
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post('mesas/:token/pedir-cuenta')
  pedirCuenta(@Param('token') token: string, @Body() body: { metodo?: Metodo; moneda?: Moneda }) {
    return this.cuenta.pedirCuenta(token, body?.metodo, body?.moneda);
  }

  // ── caja (panel) ──

  @Get('admin/caja/abiertas')
  abiertas() {
    return this.cuenta.cuentasAbiertas();
  }

  @Get('admin/caja/cobrado')
  cobrado(@Query('fecha') fecha?: string) {
    return this.cuenta.cobradoDelDia(fecha || undefined);
  }

  @Get('admin/mesas/:mesaId/cuenta')
  cuentaDeMesa(@Param('mesaId') mesaId: string) {
    return this.cuenta.cuentaDeMesa(mesaId);
  }

  @Post('admin/mesas/:mesaId/cobrar')
  cobrar(
    @Param('mesaId') mesaId: string,
    @Body() body: { metodo: Metodo; moneda: Moneda; monto: number; cargadoPor?: string; referencia?: string },
  ) {
    return this.cuenta.cobrar(mesaId, body);
  }

  @Post('admin/pagos/:id/anular')
  anular(@Param('id') id: string) {
    return this.cuenta.anularPago(id);
  }
}
