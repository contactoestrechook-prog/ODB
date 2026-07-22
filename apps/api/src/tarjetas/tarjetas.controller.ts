import { Controller, Get, Query } from '@nestjs/common';
import { TarjetasService } from './tarjetas.service';
import { Roles } from '../auth/decorators';

@Controller('tarjetas')
export class TarjetasController {
  constructor(private readonly tarjetas: TarjetasService) {}

  @Roles('gerente', 'dueno')
  @Get('resumen')
  resumen(@Query('dias') dias?: string) {
    return this.tarjetas.resumen(this.dias(dias));
  }

  @Roles('gerente', 'dueno')
  @Get('pagos')
  pagos(@Query('dias') dias?: string) {
    return this.tarjetas.pagos(this.dias(dias));
  }

  private dias(v: unknown) {
    const n = Math.trunc(Number(v));
    return Number.isFinite(n) && n >= 1 && n <= 90 ? n : 30;
  }
}
