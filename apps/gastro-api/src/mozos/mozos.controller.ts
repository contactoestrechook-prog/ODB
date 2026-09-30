import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import { MozosService } from './mozos.service';

@Controller('admin/mozos')
export class MozosController {
  constructor(private readonly mozos: MozosService) {}

  @Get()
  listar() {
    return this.mozos.listar();
  }

  @Post()
  crear(@Body() body: { nombre: string }) {
    return this.mozos.crear(body.nombre);
  }

  @Put(':id')
  actualizar(@Param('id') id: string, @Body() body: { activo: boolean }) {
    return this.mozos.actualizar(id, body.activo);
  }
}
