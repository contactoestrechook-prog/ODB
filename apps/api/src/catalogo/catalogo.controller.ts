import { Controller, Get, Param, Query } from '@nestjs/common';
import { CatalogoService } from './catalogo.service';
import type { FiltrosCatalogo } from './catalogo.service';
import { Publico } from '../auth/decorators';

// El catálogo es público: es lo que muestra la tienda
@Publico()
@Controller()
export class CatalogoController {
  constructor(private readonly catalogo: CatalogoService) {}

  @Get('catalogo/filtros')
  filtros() {
    return this.catalogo.filtros();
  }

  @Get('productos')
  buscar(@Query() q: FiltrosCatalogo & { limite?: string }) {
    // compat: ?limite=N (usado por la caja) equivale a porPagina
    if (q.limite && !q.porPagina) q.porPagina = q.limite;
    return this.catalogo.buscarProductos(q);
  }

  @Get('productos/:sku')
  porSku(@Param('sku') sku: string) {
    return this.catalogo.obtenerPorSku(sku);
  }

  @Get('productos/:sku/detalle')
  detalle(@Param('sku') sku: string) {
    return this.catalogo.detalle(sku);
  }

  @Get('sucursales')
  sucursales() {
    return this.catalogo.sucursales();
  }
}
