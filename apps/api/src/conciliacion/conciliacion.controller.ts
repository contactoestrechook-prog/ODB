import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { Roles } from '../auth/decorators';
import { ConciliacionService } from './conciliacion.service';

// Conciliación de medios de pago: solo dirección/gerencia.
@Roles('gerente', 'dueno')
@Controller('conciliacion')
export class ConciliacionController {
  constructor(private readonly serv: ConciliacionService) {}

  @Get('resumen')
  resumen() {
    return this.serv.resumen();
  }

  @Get()
  listar(@Query('estado') estado?: string, @Query('medio') medio?: string, @Query('dias') dias?: string) {
    return this.serv.listar({ estado, medio, dias: dias ? Number(dias) : undefined });
  }

  @Get('comisiones')
  comisiones() {
    return this.serv.comisiones();
  }

  @Patch('comisiones')
  guardarComision(@Body() b: { medio: string; comisionPct: number; diasAcreditacion: number }) {
    return this.serv.guardarComision(b.medio, b.comisionPct, b.diasAcreditacion);
  }

  // Conciliación automática con Mercado Pago
  @Post('mp')
  conciliarMP(@Req() req: any) {
    return this.serv.conciliarMP(req.usuario?.sub);
  }

  // Acreditación en lote (por medio, hasta una fecha)
  @Post('lote')
  lote(@Body() b: { medio: string; hasta: string }, @Req() req: any) {
    return this.serv.acreditarLote(b.medio, b.hasta, req.usuario?.sub);
  }

  // Marcar una acreditación con el neto real
  @Post(':id/acreditar')
  acreditar(@Param('id') id: string, @Body() b: { netoReal: number; fechaReal?: string }, @Req() req: any) {
    return this.serv.marcarAcreditada(id, b.netoReal, b.fechaReal, req.usuario?.sub);
  }
}
