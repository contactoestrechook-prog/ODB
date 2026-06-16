import { Body, Controller, Get, Param, Patch, Post, Query, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Roles } from '../auth/decorators';
import { EventosService } from './eventos.service';
import type { ItemPropuesta } from './eventos.service';

@Roles('cajero', 'gerente', 'dueno')
@Controller('eventos')
export class EventosController {
  constructor(private readonly eventos: EventosService) {}

  @Get('oportunidades')
  oportunidades(@Query('dias') dias?: string) {
    return this.eventos.oportunidades(dias ? Number(dias) : 60);
  }

  @Get('resumen')
  resumen() {
    return this.eventos.resumen();
  }

  // IA: cuesta tokens, límite estricto
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post('sugerir')
  sugerir(@Body() body: { tipo?: string; invitados?: number }) {
    return this.eventos.sugerir(body);
  }

  @Get()
  listar(@Query('estado') estado?: string, @Query('tipo') tipo?: string) {
    return this.eventos.listar({ estado, tipo });
  }

  @Post()
  crear(@Body() body: any, @Req() req: any) {
    return this.eventos.crear(body, req.usuario?.sub);
  }

  @Get(':id/presupuesto')
  async presupuesto(@Param('id') id: string, @Res() res: any) {
    const pdf = await this.eventos.presupuestoPdf(id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="presupuesto-${id.slice(0, 8)}.pdf"`);
    res.end(pdf);
  }

  @Get(':id')
  detalle(@Param('id') id: string) {
    return this.eventos.detalle(id);
  }

  @Patch(':id')
  actualizar(@Param('id') id: string, @Body() body: any) {
    return this.eventos.actualizar(id, body);
  }

  @Post(':id/propuesta')
  guardar(@Param('id') id: string, @Body() body: { items: ItemPropuesta[] }) {
    return this.eventos.guardarPropuesta(id, body.items);
  }

  @Roles('gerente', 'dueno')
  @Post(':id/enviar')
  enviar(@Param('id') id: string) {
    return this.eventos.enviarPropuesta(id);
  }
}
