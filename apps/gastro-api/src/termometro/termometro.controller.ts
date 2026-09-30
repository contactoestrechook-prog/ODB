import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { TermometroService } from './termometro.service';
import type { Sentimiento } from './termometro.service';
import { Publico } from '../auth/decorators';

@Controller()
export class TermometroController {
  constructor(private readonly termometro: TermometroService) {}

  // Lo llama el front al tocar uno de los 3 emojis en /opinar/:token
  @Publico()
  @Post('termometro')
  registrar(@Body() body: { mesaToken: string; sentimiento: Sentimiento; comentario?: string }) {
    return this.termometro.registrar(body.mesaToken, body.sentimiento, body.comentario);
  }

  // --- administración ---

  @Get('admin/alertas')
  listarAlertas(@Query('todas') todas?: string) {
    return this.termometro.listarAlertas(todas !== 'true');
  }

  @Post('admin/alertas/:id/resolver')
  resolverAlerta(@Param('id') id: string) {
    return this.termometro.resolverAlerta(id);
  }

  @Get('admin/termometro/resumen')
  resumen(@Query('dias') dias?: string) {
    return this.termometro.resumen(dias ? Number(dias) : undefined);
  }
}
