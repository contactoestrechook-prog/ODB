import { Controller, Get, Param, Query, Req } from '@nestjs/common';
import { Roles } from '../auth/decorators';
import { InventarioService } from './inventario.service';

// El inventario de un producto (Leandro, 5/11/2026): cuánto hay, cómo se movió,
// cuánto se vende y a cuánto se compra. Lo consultan los mismos que hoy ven
// Stock y la ficha del producto (administrativo entra por herencia). La caja
// ve el stock y las ventas, no los costos ni el margen.
@Roles('cajero', 'deposito', 'comprador', 'gerente', 'dueno')
@Controller('inventario')
export class InventarioController {
  constructor(private readonly inventario: InventarioService) {}

  @Get('buscar')
  buscar(@Query('q') q?: string) {
    return this.inventario.buscar(q ?? '');
  }

  @Get('para-mirar')
  paraMirar() {
    return this.inventario.paraMirar();
  }

  @Get('producto/:sku')
  producto(@Param('sku') sku: string, @Req() req: any) {
    return this.inventario.producto(sku, req.usuario?.rol !== 'cajero');
  }
}
