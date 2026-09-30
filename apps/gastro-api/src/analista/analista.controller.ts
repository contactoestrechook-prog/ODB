import { Controller, Get } from '@nestjs/common';
import { AnalistaService } from './analista.service';

@Controller('admin/analista')
export class AnalistaController {
  constructor(private readonly analista: AnalistaService) {}

  @Get('resumen')
  resumen() {
    return this.analista.resumenDeAyer();
  }

  @Get('ahora')
  ahora() {
    return this.analista.ahora();
  }
}
