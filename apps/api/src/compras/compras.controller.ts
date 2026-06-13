import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ComprasService } from './compras.service';
import type { AprobarDto, CrearOcDto, RecibirDto } from './compras.service';
import { Roles } from '../auth/decorators';

@Controller()
export class ComprasController {
  constructor(private readonly compras: ComprasService) {}

  @Get('proveedores')
  proveedores() {
    return this.compras.proveedores();
  }

  @Roles('comprador', 'gerente', 'dueno')
  @Post('proveedores')
  crearProveedor(@Body() dto: any) {
    return this.compras.crearProveedor(dto);
  }

  @Roles('comprador', 'gerente', 'dueno')
  @Patch('proveedores/:id')
  editarProveedor(@Param('id') id: string, @Body() dto: any) {
    return this.compras.editarProveedor(id, dto);
  }

  @Get('compras/resumen')
  resumen() {
    return this.compras.resumen();
  }

  @Get('compras/sugerencias')
  sugerencias() {
    return this.compras.sugerencias();
  }

  @Get('compras/deuda')
  deuda() {
    return this.compras.deudaProveedores();
  }

  @Get('compras/ordenes-pago')
  ordenesPago() {
    return this.compras.ordenesPago();
  }

  @Roles('comprador', 'gerente', 'dueno')
  @Post('compras/facturas')
  registrarFactura(@Body() dto: any) {
    return this.compras.registrarFactura(dto);
  }

  @Roles('gerente', 'dueno')
  @Post('compras/pagar')
  pagar(@Body() dto: any) {
    return this.compras.pagar(dto);
  }

  @Get('compras/ordenes')
  ordenes() {
    return this.compras.ordenes();
  }

  @Roles('comprador', 'gerente', 'dueno')
  @Post('compras/ordenes')
  crear(@Body() dto: CrearOcDto) {
    return this.compras.crear(dto);
  }

  @Roles('gerente', 'dueno')
  @Post('compras/ordenes/:id/aprobar')
  aprobar(@Param('id') id: string, @Body() dto: AprobarDto) {
    return this.compras.aprobar(id, dto);
  }

  @Roles('deposito', 'gerente', 'dueno')
  @Post('compras/ordenes/:id/recibir')
  recibir(@Param('id') id: string, @Body() dto: RecibirDto) {
    return this.compras.recibir(id, dto);
  }
}
