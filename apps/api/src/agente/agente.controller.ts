import { Body, Controller, Get, Param, Post, Query, Req, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
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

  @Post('fotos')
  fotos(@Body() dto: { limite?: number }) {
    return this.servicio.buscarFotos(dto ?? {});
  }

  // Pack de fotos que manda un proveedor (varios archivos de una). Tope: 60
  // archivos y 8MB c/u por request, para no abrir la puerta a un abuso.
  @Post('fotos-proveedor')
  @UseInterceptors(FilesInterceptor('archivos', 60, { limits: { fileSize: 8 * 1024 * 1024 } }))
  fotosProveedor(@UploadedFiles() archivos: Express.Multer.File[], @Body('proveedorId') proveedorId?: string) {
    return this.servicio.importarFotosProveedor(archivos, proveedorId);
  }

  @Post('tareas/:id/resolver')
  resolver(@Param('id') id: string, @Req() req: any) {
    return this.servicio.resolver(Number(id), req.usuario?.sub);
  }
}
