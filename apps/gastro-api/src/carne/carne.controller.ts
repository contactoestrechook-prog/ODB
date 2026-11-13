import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { CarneService } from './carne.service';

@Controller('admin/carne')
export class CarneController {
  constructor(private readonly carne: CarneService) {}

  @Get('cortes')
  cortes() {
    return this.carne.cortes();
  }

  @Post('cortes')
  crearCorte(@Body() body: { nombre: string; rindeObjetivoPct?: number }) {
    return this.carne.crearCorte(body.nombre, body.rindeObjetivoPct);
  }

  @Put('cortes/:id')
  actualizarCorte(@Param('id') id: string, @Body() body: { nombre?: string; rindeObjetivoPct?: number; activo?: boolean }) {
    return this.carne.actualizarCorte(id, body);
  }

  @Put('compra-items/:id')
  marcarCompra(@Param('id') id: string, @Body() body: { corteId: string | null; kilos: number | null }) {
    return this.carne.marcarCompra(id, body.corteId, body.kilos);
  }

  @Get('rendimiento')
  rendimiento(@Query('dias') dias?: string) {
    const n = Number(dias);
    return this.carne.rendimiento([7, 30, 90].includes(n) ? n : 30);
  }

  @Get('mise-en-place')
  miseEnPlace() {
    return this.carne.miseEnPlace();
  }
}
