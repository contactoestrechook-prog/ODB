import { Controller, Get, Headers, Param, Query } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { CatalogoService } from './catalogo.service';
import type { FiltrosCatalogo } from './catalogo.service';
import { Publico } from '../auth/decorators';

// El catálogo es público: es lo que muestra la tienda.
// Si llega un token de cliente verificado, se aplican además
// las promociones exclusivas de la Comunidad ODB.
@Publico()
@Controller()
export class CatalogoController {
  constructor(
    private readonly catalogo: CatalogoService,
    private readonly jwt: JwtService,
  ) {}

  private async esComunidad(authorization?: string): Promise<boolean> {
    const token = (authorization ?? '').replace(/^Bearer /, '');
    if (!token) return false;
    try {
      const payload = await this.jwt.verifyAsync(token);
      return payload.rol === 'cliente' && payload.verificado === true;
    } catch {
      return false;
    }
  }

  @Get('catalogo/filtros')
  filtros() {
    return this.catalogo.filtros();
  }

  @Get('productos')
  async buscar(
    @Query() q: FiltrosCatalogo & { limite?: string },
    @Headers('authorization') auth?: string,
  ) {
    if (q.limite && !q.porPagina) q.porPagina = q.limite;
    return this.catalogo.buscarProductos(q, await this.esComunidad(auth));
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
