import { Body, Controller, Get, Post } from '@nestjs/common';
import { AnalistaService } from './analista.service';
import type { MensajeChat } from './analista.service';
import { Roles } from '../auth/decorators';

@Roles('comprador', 'gerente', 'dueno')
@Controller('analista')
export class AnalistaController {
  constructor(private readonly analista: AnalistaService) {}

  @Get('metricas')
  metricas() {
    return this.analista.metricas();
  }

  @Post('charla')
  charlar(@Body() body: { mensajes: MensajeChat[] }) {
    return this.analista.charlar(body.mensajes);
  }

  @Post('armados')
  armados(@Body() body: { contexto?: string }) {
    return this.analista.armados(body?.contexto);
  }
}
