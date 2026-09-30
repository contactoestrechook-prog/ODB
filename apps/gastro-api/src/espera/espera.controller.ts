import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { EsperaService } from './espera.service';

@Controller('admin/espera')
export class EsperaController {
  constructor(private readonly espera: EsperaService) {}

  @Get()
  listar() {
    return this.espera.listar();
  }

  @Get('resumen')
  resumen() {
    return this.espera.resumenHoy();
  }

  @Post()
  agregar(@Body() body: { nombre: string; telefono: string; personas: number; idioma?: 'es' | 'pt' | 'en' }) {
    return this.espera.agregar(body.nombre, body.telefono, body.personas, body.idioma);
  }

  @Post(':id/avisar')
  avisar(@Param('id') id: string) {
    return this.espera.avisar(id);
  }

  @Post(':id/sentar')
  sentar(@Param('id') id: string) {
    return this.espera.sentar(id);
  }

  @Post(':id/abandono')
  abandono(@Param('id') id: string) {
    return this.espera.abandono(id);
  }
}
