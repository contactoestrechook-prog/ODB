import { Controller, Get, Param, Query } from '@nestjs/common';
import { CatalogoService } from './catalogo.service';
import { Publico } from '../auth/decorators';

// El catálogo es público: es lo que muestra la tienda
@Publico()
@Controller()
export class CatalogoController {
  constructor(private readonly catalogo: CatalogoService) {}

  @Get('productos')
  buscar(@Query('buscar') buscar?: string, @Query('limite') limite?: string) {
    return this.catalogo.buscarProductos(buscar, limite ? Number(limite) : undefined);
  }

  @Get('productos/:sku')
  porSku(@Param('sku') sku: string) {
    return this.catalogo.obtenerPorSku(sku);
  }

  @Get('sucursales')
  sucursales() {
    return this.catalogo.sucursales();
  }
}
