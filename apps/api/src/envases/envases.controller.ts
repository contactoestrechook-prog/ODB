import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { Roles } from '../auth/decorators';
import { EnvasesService } from './envases.service';

// Envases retornables (Quilmes/Coca/sifones/barriles): operación + dirección.
@Roles('cajero', 'deposito', 'gerente', 'dueno', 'repartidor')
@Controller('envases')
export class EnvasesController {
  constructor(private readonly serv: EnvasesService) {}

  @Get('resumen')
  resumen() {
    return this.serv.resumen();
  }

  @Get('saldos')
  saldos() {
    return this.serv.saldos();
  }

  @Get('tipos')
  tipos() {
    return this.serv.tipos();
  }

  @Post('tipos')
  crearTipo(@Body() b: { nombre: string; valor?: number }) {
    return this.serv.crearTipo(b);
  }

  @Post('movimiento')
  movimiento(@Body() b: any, @Req() req: any) {
    return this.serv.movimiento({ ...b, usuarioId: req.usuario?.sub });
  }

  @Get('cliente/:id')
  detalle(@Param('id') id: string) {
    return this.serv.detalleCliente(id);
  }
}
