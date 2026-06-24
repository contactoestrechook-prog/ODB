import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { Roles } from '../auth/decorators';
import { ComparadorService } from './comparador.service';

// Comparador / Proveedores: abastecimiento (gerencia/dueño/comprador).
@Roles('gerente', 'dueno', 'comprador')
@Controller('comparador')
export class ComparadorController {
  constructor(private readonly serv: ComparadorService) {}

  @Get()
  comparar() {
    return this.serv.comparar();
  }

  @Get('directorio')
  directorio() {
    return this.serv.directorio();
  }

  @Get('stats')
  stats() {
    return this.serv.stats();
  }

  @Get('proveedores')
  proveedores() {
    return this.serv.proveedores();
  }

  @Patch('proveedor/:id')
  guardar(@Param('id') id: string, @Body() b: { condicionPago?: string; descuentoEfectivo?: number; leadTimeDias?: number; telefono?: string; email?: string; cuit?: string }) {
    return this.serv.guardarTerminos(id, b);
  }

  // Cargar lista de un proveedor nuevo y analizarla contra los existentes (sin escribir).
  @Post('analizar-lista')
  analizar(@Body() b: { proveedorNombre: string; markup?: number; descuentoEfectivo?: number; texto?: string; archivo?: { base64: string; mime: string; nombre?: string } }) {
    return this.serv.analizarLista(b);
  }

  // Aplicar la lista analizada (alta proveedor + base + costos/precios).
  @Post('aplicar-lista')
  aplicar(@Body() b: { proveedorNombre: string; markup?: number; descuentoEfectivo?: number; vigencia?: string; items: any[] }) {
    return this.serv.aplicarLista(b);
  }

  // Interpretar una aclaración dictada por voz/texto (bonificación, 2x1, % efectivo).
  @Post('interpretar-aclaracion')
  interpretar(@Body() b: { texto: string }) {
    return this.serv.interpretarAclaracion(b);
  }
}
