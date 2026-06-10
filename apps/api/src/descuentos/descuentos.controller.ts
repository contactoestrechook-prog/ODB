import { Body, Controller, Get, Post } from '@nestjs/common';
import { DescuentosService } from './descuentos.service';
import type { CrearDescuentoDto } from './descuentos.service';

@Controller('descuentos')
export class DescuentosController {
  constructor(private readonly descuentos: DescuentosService) {}

  @Get()
  listar() {
    return this.descuentos.listar();
  }

  @Post()
  crear(@Body() dto: CrearDescuentoDto) {
    return this.descuentos.crear(dto);
  }
}
