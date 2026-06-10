import { Body, Controller, Get, Post } from '@nestjs/common';
import { DescuentosService } from './descuentos.service';
import type { CrearDescuentoDto } from './descuentos.service';
import { Publico, Roles } from '../auth/decorators';

@Controller('descuentos')
export class DescuentosController {
  constructor(private readonly descuentos: DescuentosService) {}

  @Publico()
  @Get()
  listar() {
    return this.descuentos.listar();
  }

  @Roles('gerente', 'dueno')
  @Post()
  crear(@Body() dto: CrearDescuentoDto) {
    return this.descuentos.crear(dto);
  }
}
