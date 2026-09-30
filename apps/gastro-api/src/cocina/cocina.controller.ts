import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CocinaService } from './cocina.service';

@Controller('admin')
export class CocinaController {
  constructor(private readonly cocina: CocinaService) {}

  @Post('mesas/:mesaId/comanda')
  tomarComanda(@Param('mesaId') mesaId: string, @Body() body: { items: { itemId: string; cantidad: number }[] }) {
    return this.cocina.tomarComanda(mesaId, body.items);
  }

  @Get('cocina/tablero')
  tablero() {
    return this.cocina.tablero();
  }

  @Get('cocina/metricas')
  metricas() {
    return this.cocina.metricas();
  }

  @Post('cocina/items/:id/empezar')
  empezar(@Param('id') id: string) {
    return this.cocina.empezar(id);
  }

  @Post('cocina/items/:id/listo')
  listo(@Param('id') id: string) {
    return this.cocina.listo(id);
  }

  @Post('cocina/items/:id/entregado')
  entregado(@Param('id') id: string) {
    return this.cocina.entregado(id);
  }
}
