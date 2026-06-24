import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { Roles } from '../auth/decorators';
import { RepartosService } from './repartos.service';

@Controller('repartos')
export class RepartosController {
  constructor(private readonly serv: RepartosService) {}

  @Roles('gerente', 'dueno', 'repartidor')
  @Get()
  listar(@Query('dias') dias?: string) {
    return this.serv.listar(Number(dias) || 7);
  }

  // Flota en vivo (mapa de repartidores) — dirección
  @Roles('gerente', 'dueno')
  @Get('flota')
  flota() {
    return this.serv.flota();
  }

  @Roles('gerente', 'dueno', 'cajero')
  @Get('choferes')
  choferes() {
    return this.serv.choferes();
  }

  @Roles('gerente', 'dueno', 'cajero')
  @Get('clientes-zona')
  clientesZona(@Query('zona') zona?: string) {
    return this.serv.clientesZona(zona);
  }

  // El repartidor reporta su posición (desde la app) cada X seg
  @Roles('repartidor', 'gerente', 'dueno')
  @Post('posicion')
  posicion(@Body() b: { lat: number; lng: number; repartoId?: string }, @Req() req: any) {
    return this.serv.reportarPosicion(req.usuario?.sub, b.lat, b.lng, b.repartoId);
  }

  @Roles('gerente', 'dueno')
  @Post()
  crear(@Body() b: any, @Req() req: any) {
    return this.serv.crear({ ...b, usuarioId: req.usuario?.sub });
  }

  @Roles('gerente', 'dueno', 'repartidor')
  @Get(':id')
  detalle(@Param('id') id: string) {
    return this.serv.detalle(id);
  }

  @Roles('gerente', 'dueno', 'cajero')
  @Post(':id/paradas')
  agregar(@Param('id') id: string, @Body() b: any) {
    return this.serv.agregarParada(id, b);
  }

  @Roles('gerente', 'dueno', 'cajero')
  @Post(':id/traer-zona')
  traer(@Param('id') id: string, @Body() b: { zona: string }) {
    return this.serv.traerZona(id, b.zona);
  }

  @Roles('gerente', 'dueno', 'repartidor')
  @Post('parada/:pid')
  marcar(@Param('pid') pid: string, @Body() b: any) {
    return this.serv.marcarParada(pid, b);
  }

  @Roles('gerente', 'dueno', 'repartidor')
  @Post(':id/estado')
  estado(@Param('id') id: string, @Body() b: { estado: string }) {
    return this.serv.cambiarEstado(id, b.estado);
  }
}
