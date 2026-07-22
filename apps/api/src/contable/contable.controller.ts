import { Controller, Get, Query } from '@nestjs/common';
import { ContableService } from './contable.service';
import { Roles } from '../auth/decorators';

@Controller('contable')
export class ContableController {
  constructor(private readonly contable: ContableService) {}

  // Un período en un solo paquete: mes=YYYY-MM, o rango libre desde/hasta
  // (YYYY-MM-DD inclusive) para hoy / semana / quincena / semestre.
  @Roles('gerente', 'dueno')
  @Get()
  resumen(@Query('mes') mes?: string, @Query('desde') desde?: string, @Query('hasta') hasta?: string) {
    return this.contable.resumen({ mes, desde, hasta });
  }

  // El año mes a mes (comparativo)
  @Roles('gerente', 'dueno')
  @Get('anual')
  anual(@Query('anio') anio?: string) {
    return this.contable.anual(anio);
  }
}
