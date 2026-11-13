import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { TableroService } from './tablero.service';

const aDias = (d?: string) => {
  const n = Number(d);
  return [7, 30, 90].includes(n) ? n : 30;
};

@Controller('admin/tablero')
export class TableroController {
  constructor(private readonly tablero: TableroService) {}

  @Get('mozos')
  mozos(@Query('dias') dias?: string) {
    return this.tablero.mozos(aDias(dias));
  }

  @Get('menu')
  menu(@Query('dias') dias?: string) {
    return this.tablero.menu(aDias(dias));
  }

  @Get('pronostico')
  pronostico() {
    return this.tablero.pronostico();
  }

  @Get('cobros')
  cobros(@Query('dias') dias?: string) {
    return this.tablero.cobros(aDias(dias));
  }

  @Get('resumen-whatsapp')
  resumenWhatsapp() {
    return this.tablero.resumenWhatsapp();
  }

  @Get('feriados')
  feriados() {
    return this.tablero.feriados();
  }

  @Post('feriados')
  agregarFeriado(@Body() body: { fecha: string; pais: 'AR' | 'BR'; nombre: string }) {
    return this.tablero.agregarFeriado(body.fecha, body.pais, body.nombre);
  }

  @Delete('feriados/:id')
  quitarFeriado(@Param('id') id: string) {
    return this.tablero.quitarFeriado(id);
  }
}
