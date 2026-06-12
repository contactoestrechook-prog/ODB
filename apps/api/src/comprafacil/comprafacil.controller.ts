import {
  Body, Controller, Get, Param, Post, Req, UnauthorizedException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CompraFacilService } from './comprafacil.service';
import { Roles } from '../auth/decorators';

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
