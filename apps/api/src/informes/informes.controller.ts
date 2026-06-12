import { Body, Controller, Get, Post } from '@nestjs/common';
import { InformesService } from './informes.service';
import { Roles } from '../auth/decorators';

@Roles('dueno', 'gerente', 'comprador')
@Controller('informes')
export class InformesController {
  constructor(private readonly servicio: InformesService) {}

  @Get()
  listar() {
    return this.servicio.listar();
  }

  // Regeneración manual (por defecto, el informe de ayer)
  @Post('generar')
  generar(@Body() cuerpo: { fecha?: string }) {
    return this.servicio.generar(cuerpo?.fecha);
  }
}
