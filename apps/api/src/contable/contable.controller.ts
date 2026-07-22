import { Controller, Get, Query } from '@nestjs/common';
import { ContableService } from './contable.service';
import { Roles } from '../auth/decorators';

@Controller('contable')
export class ContableController {
  constructor(private readonly contable: ContableService) {}

  // Todo el mes en un solo paquete: IVA ventas/compras, percepciones, posición
  @Roles('gerente', 'dueno')
  @Get()
  resumen(@Query('mes') mes?: string) {
    return this.contable.resumen(mes);
  }
}
