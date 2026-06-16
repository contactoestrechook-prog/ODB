import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { Roles } from '../auth/decorators';
import { MensajesService } from './mensajes.service';
import type { EnviarDto, ResponderDto } from './mensajes.service';
import { AutomaticasService } from './automaticas.service';

// Panel: atención al cliente + envío de notificaciones.
@Controller()
export class MensajesController {
  constructor(
    private readonly mensajes: MensajesService,
    private readonly automaticas: AutomaticasService,
  ) {}

  @Roles('cajero', 'gerente', 'dueno')
  @Get('solicitudes')
  solicitudes(@Query('estado') estado?: string, @Query('tipo') tipo?: string) {
    return this.mensajes.solicitudes({ estado, tipo });
  }

  @Roles('cajero', 'gerente', 'dueno')
  @Patch('solicitudes/:id')
  responder(@Param('id') id: string, @Body() dto: ResponderDto, @Req() req: any) {
    return this.mensajes.responder(id, dto, req.usuario?.sub);
  }

  @Roles('cajero', 'gerente', 'dueno')
  @Get('mensajes/resumen')
  resumen() {
    return this.mensajes.resumen();
  }

  @Roles('cajero', 'gerente', 'dueno')
  @Get('mensajes/historial')
  historial() {
    return this.mensajes.historial();
  }

  @Roles('cajero', 'gerente', 'dueno')
  @Get('mensajes/segmentos')
  segmentos() {
    return this.mensajes.segmentos();
  }

  @Roles('gerente', 'dueno')
  @Post('mensajes/enviar')
  enviar(@Body() dto: EnviarDto) {
    return this.mensajes.enviar(dto);
  }

  @Roles('cajero', 'gerente', 'dueno')
  @Get('mensajes/automaticas')
  automaticasPreview() {
    return this.automaticas.preview();
  }

  @Roles('gerente', 'dueno')
  @Post('mensajes/automaticas/correr')
  correrAutomaticas() {
    return this.automaticas.correrTodas();
  }
}
