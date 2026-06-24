import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { AgenteService } from './agente.service';
import { Roles } from '../auth/decorators';

@Roles('gerente', 'dueno')
@Controller('agente')
export class AgenteController {
  constructor(private readonly servicio: AgenteService) {}

  @Get('resumen')
  resumen() {
    return this.servicio.resumen();
  }

  @Get('tareas')
  tareas(@Query('estado') estado?: string) {
    return this.servicio.tareas(estado);
  }

  @Get('tareas/:id/auditoria')
  auditoria(@Param('id') id: string) {
    return this.servicio.auditoria(Number(id));
  }

  @Post('encolar')
  encolar(@Body() dto: { descripcion: string; tipo?: string }) {
    return this.servicio.encolar(dto.descripcion, dto.tipo);
  }

  @Post('tareas/:id/ejecutar')
  ejecutar(@Param('id') id: string) {
    return this.servicio.ejecutar(Number(id));
  }

  @Post('procesar')
  procesar(@Body() dto: { limite?: number }) {
    return this.servicio.procesarPendientes(dto?.limite ?? 5);
  }

  @Post('barrido')
  barrido(@Body() dto: { limite?: number }) {
    return this.servicio.barridoMantenimiento(dto?.limite ?? 10);
  }

  @Post('enriquecer')
  enriquecer(@Body() dto: { limite?: number }) {
    return this.servicio.enriquecer(dto ?? {});
  }

  @Post('tareas/:id/resolver')
  resolver(@Param('id') id: string, @Req() req: any) {
    return this.servicio.resolver(Number(id), req.usuario?.sub);
  }
}
