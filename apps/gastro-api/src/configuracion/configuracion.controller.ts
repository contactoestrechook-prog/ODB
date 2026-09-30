import { Body, Controller, Get, Put } from '@nestjs/common';
import { ConfiguracionService } from './configuracion.service';

@Controller('admin/configuracion')
export class ConfiguracionController {
  constructor(private readonly configuracion: ConfiguracionService) {}

  @Get()
  obtener() {
    return this.configuracion.obtener();
  }

  @Put()
  actualizar(@Body() body: { nombreRestaurante?: string; capacidadAsientos?: number; horasServicioDia?: number; dosPorUnoActivo?: boolean }) {
    return this.configuracion.actualizar(body);
  }
}
