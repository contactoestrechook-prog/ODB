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

  // La entrada: cuánto alcanza el stock en cada sucursal y las listas para
  // recorrer (13/11/2026). La caja la ve sin plata (sin el valor a costo).
  @Get('entrada')
  entrada(@Query('sucursal') sucursal: string | undefined, @Query('vista') vista: string | undefined, @Query('desde') desde: string | undefined, @Req() req: any) {
    return this.inventario.entrada({ sucursal, vista, desde, conPlata: req.usuario?.rol !== 'cajero' });
  }

  @Get('mas-vendidos')
  masVendidos() {
    return this.inventario.masVendidos();
  }

  @Get('producto/:sku')
  producto(@Param('sku') sku: string, @Req() req: any) {
    return this.inventario.producto(sku, req.usuario?.rol !== 'cajero');
  }
}
