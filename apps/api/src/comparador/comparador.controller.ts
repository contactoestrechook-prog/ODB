import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { Roles } from '../auth/decorators';
import { ComparadorService } from './comparador.service';

// Comparador de proveedores: abastecimiento (gerencia/dueño/comprador).
@Roles('gerente', 'dueno', 'comprador')
@Controller('comparador')
export class ComparadorController {
  constructor(private readonly serv: ComparadorService) {}

  @Get()
  comparar() {
    return this.serv.comparar();
  }

  @Get('proveedores')
  proveedores() {
    return this.serv.proveedores();
  }

  @Patch('proveedor/:id')
  guardar(@Param('id') id: string, @Body() b: { condicionPago?: string; descuentoEfectivo?: number }) {
    return this.serv.guardarTerminos(id, b.condicionPago, b.descuentoEfectivo);
  }
}
