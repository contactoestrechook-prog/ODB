import {
  Body, Controller, Get, Param, Post, Query, Req, UnauthorizedException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CompraFacilService } from './comprafacil.service';
import { Publico, Roles } from '../auth/decorators';

@Controller()
export class CompraFacilController {
  constructor(private readonly compraFacil: CompraFacilService) {}

  // Cliente verificado (token rol 'cliente')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post('app/compra-facil')
  comprar(
    @Body() body: { sucursalId: string; items: { sku: string; cantidad: number }[] },
    @Req() req: any,
  ) {
    if (req.usuario?.rol !== 'cliente') {
      throw new UnauthorizedException('Requiere sesión de cliente');
    }
    return this.compraFacil.comprar(req.usuario.dni, body.sucursalId, body.items);
  }

  // El cliente consulta si el pago se acreditó y recibe el código de salida.
  @Get('app/compra-facil/:id/estado')
  estado(@Param('id') id: string, @Req() req: any) {
    if (req.usuario?.rol !== 'cliente') {
      throw new UnauthorizedException('Requiere sesión de cliente');
    }
    return this.compraFacil.estadoPago(id, req.usuario.dni);
  }

  // Webhook de Mercado Pago (Comprá Fácil)
  @Publico()
  @Post('comprafacil/webhook')
  webhook(@Req() req: any, @Query() query: any) {
    return this.compraFacil.webhookMP(req.rawBody, query, req.headers ?? {});
  }

  // Chequeo de disponibilidad: el panel de Mercado Pago valida la URL con un GET
  // antes de dejar guardar el webhook. Respondemos 200 para que pase la validación.
  @Publico()
  @Get('comprafacil/webhook')
  webhookPing() {
    return { ok: true };
  }

  // Lado empleado: control de salida
  @Roles('cajero', 'deposito', 'gerente', 'dueno')
  @Get('salida/:codigo')
  buscar(@Param('codigo') codigo: string) {
    return this.compraFacil.buscarSalida(codigo);
  }

  @Roles('cajero', 'deposito', 'gerente', 'dueno')
  @Post('salida/:codigo/validar')
  validar(@Param('codigo') codigo: string, @Req() req: any) {
    return this.compraFacil.validarSalida(codigo, req.usuario.sub);
  }
}
